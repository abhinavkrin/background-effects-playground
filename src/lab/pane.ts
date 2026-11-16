import { LIBRARY_DEFAULTS, type EngineKind, type Engine, type FrameReport, type LibraryOptions, type SwitchMethod, type SwitchReport } from '../engines/types';
import { LabEngine } from '../engines/lab/LabEngine';
import { LibraryEngine } from '../engines/library/LibraryEngine';
import { Store } from '../lib/store';
import { FlashDetector } from '../metrics/flashDetector';
import { PaneMetrics } from '../metrics/paneMetrics';
import { loadModelBytes, modelById, type ModelEntry } from '../models';
import type { BackgroundSetting } from '../passes/background';
import type { ViewMode } from '../passes/composite';
import type { Strategy } from '../strategies';

/** How long after a switch its gap, slowest frame and flashes are measured. */
export const SWITCH_WINDOW_MS = 3000;

export interface PaneConfig {
	engine: EngineKind;
	modelId: string;
	strategy: Strategy;
	view: ViewMode;
	/** BackgroundProcessor options, for the library engine. */
	library?: LibraryOptions;
}

/** One switch and what it cost, filled in once the measuring window has passed. */
export interface SwitchRecord extends SwitchReport {
	measured: boolean;
	/** Longest interval between output frames in the window. */
	maxGapMs?: number;
	framesInWindow?: number;
	slowestFrameMs?: number;
	/** Output frames that looked like the raw camera. */
	rawFlashes?: number;
	/** Frames the engine itself sent out raw (lab: known exactly). */
	rawReported?: number;
}

export interface PaneState {
	status: 'idle' | 'starting' | 'ready' | 'switching' | 'error';
	error?: string;
	engine?: EngineKind;
	modelId?: string;
	switches: SwitchRecord[];
}

let panes = 0;

/** An engine, its metrics, and the bookkeeping around switching its model. */
export class Pane {
	readonly id = ++panes;

	metrics = new PaneMetrics();

	readonly flash = new FlashDetector();

	readonly state = new Store<PaneState>({ status: 'idle', switches: [] });

	engine: Engine | null = null;

	private lastSampleAt = 0;

	private startRequest = 0;

	private presentLoop = 0;

	async start(config: PaneConfig, background: BackgroundSetting, size: { width: number; height: number }, bytes?: Uint8Array): Promise<void> {
		const request = ++this.startRequest;
		await this.stopEngine();
		const model = modelById(config.modelId);
		const engine: Engine = config.engine === 'lab' ? new LabEngine() : new LibraryEngine(config.library ?? LIBRARY_DEFAULTS);
		engine.onFrame = (report) => this.onFrame(engine, report);
		this.engine = engine;
		this.metrics = new PaneMetrics();
		this.frameLog = [];
		this.state.update({ status: 'starting', error: undefined, engine: config.engine, modelId: model.id, switches: [] });
		try {
			// One download per model, shared by every pane that runs it.
			bytes ??= await loadModelBytes(model);
			await engine.init({ model, bytes, strategy: config.strategy, background, view: config.view, width: size.width || 1280, height: size.height || 720 });
			if (request !== this.startRequest) {
				await engine.dispose();
				return;
			}
			this.state.update({ status: 'ready' });
			if (engine.kind !== 'lab') {
				this.watchPresented(engine.element as HTMLVideoElement);
			}
		} catch (e) {
			void engine.dispose();
			if (request === this.startRequest) {
				this.state.update({ status: 'error', error: e instanceof Error ? e.message : String(e) });
			}
		}
	}

	push(frame: VideoFrame): void {
		const engine = this.engine;
		if (!engine || this.state.get().status === 'starting' || this.state.get().status === 'error') {
			return;
		}
		if (this.flash.armed || performance.now() - this.lastSampleAt > 500) {
			this.flash.sampleInput(frame);
		}
		engine.push(frame);
	}

	setBackground(background: BackgroundSetting): Promise<void> {
		return this.engine?.setBackground(background) ?? Promise.resolve();
	}

	setStrategy(strategy: Strategy): Promise<void> {
		return this.engine?.setStrategy(strategy) ?? Promise.resolve();
	}

	setView(view: ViewMode): void {
		this.engine?.setView(view);
	}

	/** Switches the running engine to `model` and measures the cost over the following window. */
	async switchModel(model: ModelEntry, bytes: Uint8Array, method: SwitchMethod): Promise<SwitchRecord> {
		const engine = this.engine;
		if (!engine) {
			throw new Error('pane not started');
		}
		this.flash.arm(SWITCH_WINDOW_MS + 2000);
		const rawBefore = this.metrics.rawFrames;
		this.state.update({ status: 'switching' });
		const report = await engine.switchModel(model, bytes, method);
		const record: SwitchRecord = { ...report, measured: false };
		this.state.update({ status: 'ready', modelId: engine.modelId, switches: [...this.state.get().switches, record] });
		setTimeout(() => {
			const to = report.startedAt + report.callMs + SWITCH_WINDOW_MS;
			const { maxGapMs, frames } = this.metrics.gap(report.startedAt, to);
			const measured: SwitchRecord = {
				...record,
				measured: true,
				maxGapMs,
				framesInWindow: frames,
				slowestFrameMs: this.slowestBetween(report.startedAt, to),
				rawFlashes: this.flash.flashesBetween(report.startedAt, to),
				rawReported: this.metrics.rawFrames - rawBefore,
			};
			this.state.update({ switches: this.state.get().switches.map((entry) => (entry === record ? measured : entry)) });
		}, report.callMs + SWITCH_WINDOW_MS + 100);
		return record;
	}

	async dispose(): Promise<void> {
		this.startRequest++;
		await this.stopEngine();
		this.state.update({ status: 'idle' });
	}

	private frameLog: Array<{ at: number; frameMs: number }> = [];

	private slowestBetween(from: number, to: number): number {
		return Math.max(0, ...this.frameLog.filter((entry) => entry.at >= from && entry.at <= to).map((entry) => entry.frameMs));
	}

	private onFrame(engine: Engine, report: FrameReport): void {
		if (engine !== this.engine) {
			return;
		}
		this.metrics.recordFrame(report);
		this.frameLog.push({ at: report.at, frameMs: report.frameMs });
		if (this.frameLog.length > 600) {
			this.frameLog.shift();
		}
		if (engine.kind === 'lab' && this.sampleDue()) {
			this.flash.sampleOutput(engine.element);
		}
	}

	private sampleDue(): boolean {
		const now = performance.now();
		if (this.flash.armed || now - this.lastSampleAt > 500) {
			this.lastSampleAt = now;
			return true;
		}
		return false;
	}

	/** A library engine's output is a <video>; it is sampled as frames are presented, which is what a viewer sees. */
	private watchPresented(video: HTMLVideoElement): void {
		const loop = ++this.presentLoop;
		const onPresented = () => {
			if (loop !== this.presentLoop || this.engine?.element !== video) {
				return;
			}
			if (this.sampleDue() && video.videoWidth > 0) {
				this.flash.sampleOutput(video);
			}
			video.requestVideoFrameCallback(onPresented);
		};
		video.requestVideoFrameCallback(onPresented);
	}

	private async stopEngine(): Promise<void> {
		this.presentLoop++;
		const engine = this.engine;
		this.engine = null;
		await engine?.dispose();
	}
}
