import { PROPOSED_DEFAULTS, type EngineKind, type SwitchMethod } from '../engines/types';
import type { Pane } from '../lab/pane';
import { lab } from '../lab/lab';
import type { Params } from '../lib/params';
import { Store } from '../lib/store';
import { LARGE_MODEL_ID, SMALL_MODEL_ID, loadModelBytes, modelById } from '../models';
import { conditions } from '../sim/conditions';
import type { Strategy } from '../strategies';
import { listCached, readCached } from './cache';
import { downloadModel, type DownloadProgress } from './download';
import { policyById } from './index';
import { deviceSignals, effectiveType, isHidden, observePressure, pressure } from './signals';
import type { PolicyAction, PolicyContext, PolicyEvent, PolicyStartContext, PolicyStateBase, SwitchingPolicy } from './types';
import { readVerdict, writeVerdict } from './verdict';
import { probeInWorker, type ProbeResult } from './warmup';

export type TimelineEventKind = 'start' | 'download-start' | 'download-end' | 'probe' | 'swap' | 'probation' | 'downgrade' | 'persist' | 'recover' | 'note' | 'error';

export interface TimelineSample {
	/** Seconds since the call started. */
	t: number;
	ratio: number | null;
	frameP50?: number;
	frameP90?: number;
	model: string;
	state: string;
}

export interface TimelineEvent {
	t: number;
	kind: TimelineEventKind;
	label: string;
	ok?: boolean;
}

export interface RunnerState {
	running: boolean;
	policyId: string;
	stateName: string;
	activeModel: string;
	callStartedAt: number;
	download?: DownloadProgress & { model: string; startedAt: number };
	lastProbe?: ProbeResult & { model: string };
	cached: string[];
}

const POLL_CPU_MS = 2000;

/**
 * Plays one simulated call: starts the pane on the policy's model, steps the policy once a second, carries out what
 * it asks for (download, worker probe, in-place swap, recovery, verdict) and records everything for the timeline.
 */
export class PolicyRunner {
	readonly state = new Store<RunnerState>({ running: false, policyId: 'gated', stateName: '-', activeModel: SMALL_MODEL_ID, callStartedAt: 0, cached: [] });

	samples: TimelineSample[] = [];

	events: TimelineEvent[] = [];

	private policy: SwitchingPolicy | undefined;

	private params: Params = {};

	private policyState: PolicyStateBase | undefined;

	private pending: PolicyEvent[] = [];

	private timers: Array<ReturnType<typeof setInterval>> = [];

	private cpuPolls: boolean[] = [];

	private lastCpuLimitedAt: number | null = null;

	private goodSince: number | null = null;

	private lastSwapAt = 0;

	private effectSince = 0;

	private downloadAbort: AbortController | undefined;

	private readonly bytes = new Map<string, Uint8Array>();

	private cached = new Set<string>();

	private run = 0;

	constructor(readonly pane: Pane) {
		observePressure();
		lab.background.subscribe(() => {
			this.effectSince = lab.background.get().mode === 'none' ? 0 : performance.now();
		});
	}

	get small(): string {
		return SMALL_MODEL_ID;
	}

	get large(): string {
		return LARGE_MODEL_ID;
	}

	/** Starts a call with `policyId`; the pane restarts on the model the policy picks. */
	async start(options: { policyId: string; params: Params; engine: EngineKind; strategy: Strategy }): Promise<void> {
		this.stop();
		const run = ++this.run;
		this.policy = policyById(options.policyId);
		this.params = { ...this.policy.defaults, ...options.params };
		this.samples = [];
		this.events = [];
		this.pending = [];
		this.cpuPolls = [];
		this.lastCpuLimitedAt = null;
		this.goodSince = null;
		await this.refreshCache();
		const startContext = this.startContext();
		const { state, model, note, actions } = this.policy.start(startContext, this.params);
		this.policyState = state;
		const now = performance.now();
		this.effectSince = lab.background.get().mode === 'none' ? 0 : now;
		this.state.set({ ...this.state.get(), running: true, policyId: this.policy.id, stateName: state.name, activeModel: model, callStartedAt: now, download: undefined });
		this.event('start', `start on ${model} (${options.engine}); ${note ?? state.name}`);
		const bytes = model === this.small ? await loadModelBytes(modelById(model)) : await this.bytesFor(model);
		if (run !== this.run) {
			return;
		}
		const { width, height } = lab.source.state.get();
		await this.pane.start({ engine: options.engine, modelId: model, strategy: options.strategy, view: 'effect', library: PROPOSED_DEFAULTS }, lab.background.get(), { width, height }, bytes ?? undefined);
		if (run !== this.run) {
			return;
		}
		this.lastSwapAt = performance.now();
		this.execute(actions ?? []);
		this.timers.push(setInterval(() => this.tick(), 1000));
		this.timers.push(setInterval(() => this.pollCpu(), POLL_CPU_MS));
	}

	stop(): void {
		this.run++;
		this.timers.forEach((timer) => clearInterval(timer));
		this.timers = [];
		this.downloadAbort?.abort();
		if (this.state.get().running) {
			this.event('note', 'call ended');
		}
		this.state.update({ running: false });
	}

	/** A switch outside the policy, to compare methods or set up a scenario. */
	async manualSwitch(modelId: string, method: SwitchMethod): Promise<void> {
		const model = modelById(modelId);
		const bytes = (await this.bytesFor(modelId)) ?? (await loadModelBytes(model));
		await this.swap(modelId, bytes, method);
	}

	/** The simulated download on its own, outside the policy. */
	async manualDownload(modelId: string): Promise<void> {
		await this.download(modelId);
	}

	async manualProbe(modelId: string): Promise<ProbeResult> {
		const bytes = (await this.bytesFor(modelId)) ?? (await loadModelBytes(modelById(modelId)));
		return this.probe(modelId, bytes);
	}

	async refreshCache(): Promise<void> {
		const entries = await listCached();
		this.cached = new Set(entries.flatMap((entry) => (entry.model && entry.bytes === entry.model.bytes ? [entry.model.id] : [])));
		this.state.update({ cached: [...this.cached] });
	}

	private startContext(): PolicyStartContext {
		const device = deviceSignals();
		return {
			device,
			small: this.small,
			large: this.large,
			cached: (id) => this.cached.has(id),
			verdict: readVerdict(device.renderer, modelById(this.large).sha256),
		};
	}

	private tick(): void {
		const policy = this.policy;
		const state = this.policyState;
		if (!policy || !state) {
			return;
		}
		const now = performance.now();
		const c = conditions.get();
		const good = c.connectionQuality === 'excellent' || c.connectionQuality === 'good';
		this.goodSince = good ? (this.goodSince ?? now) : null;
		const events = this.pending;
		this.pending = [];
		const metrics = this.pane.metrics;
		const ctx: PolicyContext = {
			...this.startContext(),
			now,
			callUpS: (now - this.state.get().callStartedAt) / 1000,
			effectInUseS: this.effectSince ? (now - this.effectSince) / 1000 : 0,
			hidden: isHidden(),
			sinceSwapS: (now - this.lastSwapAt) / 1000,
			ratio: (seconds) => metrics.ratio(seconds, now),
			cpuPolls: this.cpuPolls,
			lastCpuLimitedAgoS: this.lastCpuLimitedAt === null ? null : (now - this.lastCpuLimitedAt) / 1000,
			pressure: pressure(),
			quality: c.connectionQuality,
			goodQualityForS: this.goodSince === null ? 0 : (now - this.goodSince) / 1000,
			effectiveType: effectiveType(),
			activeModel: this.state.get().activeModel,
			downloading: !!this.downloadAbort,
			events,
		};
		const step = policy.step(state, ctx, this.params);
		if (step.state.name !== state.name) {
			const kind = step.state.name === 'FINAL' && state.name !== 'CANDIDATE' ? 'downgrade' : step.state.name === 'MULTICLASS' ? 'probation' : 'note';
			this.event(kind, `${state.name} -> ${step.state.name}${step.note ? `: ${step.note}` : ''}`);
		} else if (step.note) {
			this.event('note', step.note);
		}
		this.policyState = step.state;
		const snapshot = metrics.snapshot();
		this.samples.push({ t: (now - this.state.get().callStartedAt) / 1000, ratio: metrics.ratio(1, now), frameP50: snapshot.frameP50, frameP90: snapshot.frameP90, model: this.state.get().activeModel, state: step.state.name });
		if (this.samples.length > 3600) {
			this.samples.shift();
		}
		this.state.update({ stateName: step.state.name });
		this.execute(step.actions ?? []);
	}

	private pollCpu(): void {
		const limited = conditions.get().cpuLimited;
		this.cpuPolls = [...this.cpuPolls.slice(-9), limited];
		if (limited) {
			this.lastCpuLimitedAt = performance.now();
		}
	}

	private execute(actions: PolicyAction[]): void {
		for (const action of actions) {
			switch (action.type) {
				case 'download':
					void this.download(action.model).then(
						() => this.pending.push({ type: 'download', ok: true, model: action.model }),
						(e) => this.pending.push({ type: 'download', ok: false, model: action.model, error: String(e instanceof Error ? e.message : e) }),
					);
					break;
				case 'abort-download':
					this.downloadAbort?.abort();
					break;
				case 'probe':
					void this.bytesFor(action.model).then(async (bytes) => {
						if (!bytes) {
							this.pending.push({ type: 'probe', ok: false, model: action.model, error: 'no bytes' });
							return;
						}
						const result = await this.probe(action.model, bytes);
						this.pending.push({ type: 'probe', ok: result.ok, model: action.model, medianMs: result.readbackMedianMs, p90Ms: result.readbackP90Ms, error: result.error });
					});
					break;
				case 'swap':
				case 'recover':
					void (async () => {
						const bytes = (await this.bytesFor(action.model)) ?? (await loadModelBytes(modelById(action.model)));
						const ok = await this.swap(action.model, bytes, action.type === 'swap' ? 'in-place' : 'restart');
						this.pending.push({ type: action.type, ok: ok.ok, model: action.model, error: ok.error });
					})();
					break;
				case 'persist': {
					const verdict = writeVerdict({ model: action.model, modelSha: modelById(this.large).sha256, renderer: deviceSignals().renderer, reason: action.reason }, action.days);
					this.event('persist', `verdict ${verdict.model} (${verdict.reason}, ${action.days} d)`);
					break;
				}
			}
		}
	}

	/** Bytes of a model the runner already holds: downloaded this call, or in Cache Storage. */
	private async bytesFor(modelId: string): Promise<Uint8Array | null> {
		const held = this.bytes.get(modelId);
		if (held) {
			return held;
		}
		if (modelId === this.small) {
			// The small model ships with the app.
			return loadModelBytes(modelById(modelId));
		}
		const cached = this.cached.has(modelId) ? await readCached(modelById(modelId)) : null;
		if (cached) {
			this.bytes.set(modelId, cached);
		}
		return cached;
	}

	private async download(modelId: string): Promise<Uint8Array> {
		const model = modelById(modelId);
		const cached = this.cached.has(modelId) ? await readCached(model) : null;
		if (cached && cached.length === model.bytes) {
			this.bytes.set(modelId, cached);
			this.event('download-end', `${modelId} from Cache Storage`, true);
			return cached;
		}
		const abort = new AbortController();
		this.downloadAbort = abort;
		const startedAt = performance.now();
		this.event('download-start', `download ${modelId} at ${conditions.get().downloadKbps || 'full'} kbps`);
		try {
			const bytes = await downloadModel(model, conditions.get(), abort.signal, (progress) =>
				this.state.update({ download: { ...progress, model: modelId, startedAt } }),
			);
			this.bytes.set(modelId, bytes);
			await this.refreshCache();
			this.event('download-end', `downloaded ${modelId} (${(bytes.length / 1e6).toFixed(2)} MB in ${((performance.now() - startedAt) / 1000).toFixed(1)} s)`, true);
			return bytes;
		} catch (e) {
			this.event('download-end', `download failed: ${e instanceof Error ? e.message : String(e)}`, false);
			throw e;
		} finally {
			if (this.downloadAbort === abort) {
				this.downloadAbort = undefined;
			}
			this.state.update({ download: undefined });
		}
	}

	private async probe(modelId: string, bytes: Uint8Array): Promise<ProbeResult> {
		if (conditions.get().skipWorkerProbe) {
			const skipped: ProbeResult = { ok: true, totalMs: 0, readbackMedianMs: 0, readbackP90Ms: 0, error: 'skipped (simulator)' };
			this.event('probe', `probe skipped for ${modelId}`, true);
			return skipped;
		}
		this.event('note', `worker probe of ${modelId}`);
		const result = await probeInWorker(bytes);
		this.state.update({ lastProbe: { ...result, model: modelId } });
		this.event(
			'probe',
			result.ok ? `probe ${modelId}: compile ${result.createMs} ms, median ${result.readbackMedianMs} ms, p90 ${result.readbackP90Ms} ms` : `probe ${modelId} failed: ${result.error}`,
			result.ok,
		);
		return result;
	}

	private async swap(modelId: string, bytes: Uint8Array, method: SwitchMethod): Promise<{ ok: boolean; error?: string }> {
		const errorsBefore = this.pane.metrics.errors;
		const record = await this.pane.switchModel(modelById(modelId), bytes, method);
		this.lastSwapAt = performance.now();
		if (record.ok) {
			this.state.update({ activeModel: modelId });
		}
		this.event(method === 'restart' ? 'recover' : 'swap', `${method} ${record.from} -> ${record.to}: ${record.ok ? `${record.callMs.toFixed(0)} ms` : record.error}`, record.ok);
		if (!record.ok) {
			return { ok: false, error: record.error };
		}
		// A file that loads but breaks the module shows up as errors on the next frames, not as a rejected call.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		if (this.pane.metrics.errors > errorsBefore) {
			const error = this.pane.metrics.lastError ?? 'frame errors after the swap';
			this.event('error', `frames failing after the swap: ${error}`, false);
			return { ok: false, error };
		}
		return { ok: true };
	}

	private event(kind: TimelineEventKind, label: string, ok?: boolean): void {
		const t = this.state.get().callStartedAt ? (performance.now() - this.state.get().callStartedAt) / 1000 : 0;
		this.events.push({ t, kind, label, ok });
		if (this.events.length > 500) {
			this.events.shift();
		}
	}
}
