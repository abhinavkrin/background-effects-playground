import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision';
import { createSegmenter, outputOptions, wasmHeapBytes } from '../../lib/mediapipe';
import { modelUrl, type ModelEntry } from '../../models';
import type { BackgroundSetting } from '../../passes/background';
import type { ViewMode } from '../../passes/composite';
import { GpuLoad, forcedReadback } from '../../sim/gpuLoad';
import { busyWait, conditions } from '../../sim/conditions';
import type { Strategy } from '../../strategies';
import type { Engine, EngineInit, FrameReport, SwitchMethod, SwitchReport } from '../types';
import { LabPipeline } from './pipeline';

/** A pipeline and the segmenter that renders into its context. */
interface Runtime {
	canvas: OffscreenCanvas;
	pipeline: LabPipeline;
	segmenter: ImageSegmenter;
	gpuLoad?: GpuLoad;
}

/**
 * The editable engine: the same work as the library's transformer, frame for frame, with every pass configurable.
 * Frames are processed synchronously in push(), so all panes see the same input.
 */
export class LabEngine implements Engine {
	readonly kind = 'lab' as const;

	readonly supportsViews = true;

	readonly element: HTMLCanvasElement;

	onFrame: (report: FrameReport) => void = () => undefined;

	private readonly display: CanvasRenderingContext2D;

	private runtime: Runtime | undefined;

	private model!: ModelEntry;

	private strategy!: Strategy;

	private background: BackgroundSetting = { mode: 'none' };

	private view: ViewMode = 'effect';

	private lastTimestamp = 0;

	/** The next frame goes out raw, as the library's first frame after setProcessor does. */
	private rawNextFrame = false;

	private disposed = false;

	constructor() {
		this.element = document.createElement('canvas');
		const display = this.element.getContext('2d');
		if (!display) {
			throw new Error('2D canvas is not available');
		}
		this.display = display;
	}

	get modelId(): string {
		return this.model.id;
	}

	async init(init: EngineInit): Promise<void> {
		this.model = init.model;
		this.strategy = init.strategy;
		this.background = init.background;
		this.view = init.view;
		this.element.width = init.width;
		this.element.height = init.height;
		this.runtime = await this.createRuntime(init.model, init.bytes, init.width, init.height);
	}

	push(frame: VideoFrame): void {
		const runtime = this.runtime;
		if (!runtime || this.disposed) {
			return;
		}
		const start = performance.now();
		const { canvas, pipeline, segmenter } = runtime;
		const width = frame.displayWidth;
		const height = frame.displayHeight;
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		let segmentationMs = 0;
		let error: string | undefined;
		const raw = this.rawNextFrame;
		this.rawNextFrame = false;
		if (!raw) {
			try {
				const segmentStart = performance.now();
				segmenter.segmentForVideo(frame, this.nextTimestamp(), (result: ImageSegmenterResult) => {
					segmentationMs = performance.now() - segmentStart;
					const masks = this.strategy.segmenterOutput === 'confidence' ? (result.confidenceMasks ?? []) : result.categoryMask ? [result.categoryMask] : [];
					if (masks[0]) {
						pipeline.updateMask(masks[0].getAsWebGLTexture(), this.model.maskLayout === 'background-first', this.view === 'raw-mask', frame);
					}
					result.close();
				});
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		}
		pipeline.renderFrame(frame, raw ? 'frame' : this.view);

		const { gpuExtraPasses, gpuIterations, gpuProbe, cpuBusyMs } = conditions.get();
		if (gpuExtraPasses > 0) {
			runtime.gpuLoad ??= new GpuLoad(pipeline.gl);
			runtime.gpuLoad.run(gpuExtraPasses, gpuIterations);
		}
		const gpuProbeMs = gpuProbe ? forcedReadback(pipeline.gl) : undefined;

		// Hand the frame on the way the library does (a VideoFrame of the canvas), then show it.
		const output = new VideoFrame(canvas, { timestamp: frame.timestamp });
		if (this.element.width !== width || this.element.height !== height) {
			this.element.width = width;
			this.element.height = height;
		}
		this.display.drawImage(output, 0, 0, width, height);
		output.close();

		busyWait(cpuBusyMs);
		const at = performance.now();
		this.onFrame({ at, frameMs: at - start, segmentationMs, gpuProbeMs, raw, error });
	}

	async setBackground(background: BackgroundSetting): Promise<void> {
		this.background = background;
		this.runtime?.pipeline.setBackground(background);
	}

	async setStrategy(strategy: Strategy): Promise<void> {
		const outputChanged = strategy.segmenterOutput !== this.strategy.segmenterOutput;
		this.strategy = strategy;
		this.runtime?.pipeline.setStrategy(strategy);
		if (outputChanged && this.runtime) {
			await this.runtime.segmenter.setOptions(outputOptions(strategy.segmenterOutput));
		}
	}

	setView(view: ViewMode): void {
		this.view = view;
	}

	async switchModel(model: ModelEntry, bytes: Uint8Array, method: SwitchMethod): Promise<SwitchReport> {
		const runtime = this.runtime;
		const startedAt = performance.now();
		const report: SwitchReport = { method, from: this.model.id, to: model.id, startedAt, callMs: 0, ok: false, heapBefore: wasmHeapBytes(runtime?.segmenter) };
		try {
			if (!runtime) {
				throw new Error('engine not started');
			}
			if (method === 'in-place') {
				await runtime.segmenter.setOptions({ baseOptions: { modelAssetBuffer: bytes, delegate: 'GPU' } });
			} else if (method === 'second-segmenter') {
				const next = await createSegmenter(runtime.canvas, { bytes }, this.strategy.segmenterOutput);
				const old = runtime.segmenter;
				runtime.segmenter = next;
				old.close();
			} else {
				// Build a whole new pipeline while the old one keeps running, then swap, as setProcessor does.
				const next = await this.createRuntime(model, bytes, runtime.canvas.width, runtime.canvas.height);
				this.runtime = next;
				this.rawNextFrame = true;
				this.disposeRuntime(runtime);
			}
			this.model = model;
			report.ok = true;
		} catch (e) {
			report.error = e instanceof Error ? e.message : String(e);
		}
		report.callMs = performance.now() - startedAt;
		report.heapAfter = wasmHeapBytes(this.runtime?.segmenter);
		return report;
	}

	segmenter(): ImageSegmenter | undefined {
		return this.runtime?.segmenter;
	}

	context(): WebGL2RenderingContext | undefined {
		return this.runtime?.pipeline.gl;
	}

	stream(): MediaStream {
		return this.element.captureStream(30);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.runtime) {
			this.disposeRuntime(this.runtime);
			this.runtime = undefined;
		}
	}

	private async createRuntime(model: ModelEntry, bytes: Uint8Array | undefined, width: number, height: number): Promise<Runtime> {
		const canvas = new OffscreenCanvas(width || 640, height || 360);
		// The pipeline takes the context first, as the library's setupWebGL does; MediaPipe then shares it.
		const pipeline = new LabPipeline(canvas);
		pipeline.setStrategy(this.strategy);
		pipeline.setBackground(this.background);
		const segmenter = await createSegmenter(canvas, bytes ? { bytes } : { url: modelUrl(model) }, this.strategy.segmenterOutput);
		return { canvas, pipeline, segmenter };
	}

	private disposeRuntime(runtime: Runtime): void {
		runtime.segmenter.close();
		runtime.gpuLoad?.dispose();
		runtime.pipeline.dispose();
	}

	/** segmentForVideo needs strictly increasing timestamps, also when the same still frame is sent again. */
	private nextTimestamp(): number {
		this.lastTimestamp = Math.max(this.lastTimestamp + 1, performance.now());
		return this.lastTimestamp;
	}
}
