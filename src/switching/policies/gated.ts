import { bool, num, type Params } from '../../lib/params';
import type { PressureState } from '../../sim/conditions';
import { definePolicy, type DeviceSignals, type PolicyAction, type PolicyContext } from '../types';

// Upgrades to the large model only when the device, the network and the running call all allow it. Every threshold
// is a parameter.

type Watch = { lowFor: number; cpuStreak: number; pressureFor: number };

type State =
	| { name: 'CANDIDATE'; attempts: number; nextAttemptAt: number }
	| { name: 'DOWNLOADING'; attempts: number; nextAttemptAt: number }
	| { name: 'PROBING'; attempts: number }
	| { name: 'SWAPPING'; baseline: number }
	| { name: 'PROBATION'; baseline: number; since: number; cpuAtStart: boolean }
	| ({ name: 'MULTICLASS'; since: number; persisted: boolean } & Watch)
	| ({ name: 'TRUSTED' } & Watch)
	| { name: 'FINAL'; reason: string };

const PRESSURE_ORDER: PressureState[] = ['nominal', 'fair', 'serious', 'critical'];

const atLeast = (pressure: PressureState | null, level: PressureState) => pressure !== null && PRESSURE_ORDER.indexOf(pressure) >= PRESSURE_ORDER.indexOf(level);

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Why this device should not even try the large model, or null. A missing signal is no opinion. */
export const deviceGate = (device: DeviceSignals, params: Params): string | null => {
	if (bool(params, 'rejectSoftwareRenderer', true) && SOFTWARE_RENDERER.test(device.renderer)) {
		return `software renderer (${device.renderer})`;
	}
	if (device.deviceMemory !== undefined && device.deviceMemory < num(params, 'minDeviceMemory', 4)) {
		return `deviceMemory ${device.deviceMemory} GB`;
	}
	if (device.hardwareConcurrency !== undefined && device.hardwareConcurrency < num(params, 'minCores', 4)) {
		return `hardwareConcurrency ${device.hardwareConcurrency}`;
	}
	if (bool(params, 'rejectSaveData', true) && device.saveData) {
		return 'saveData';
	}
	if (bool(params, 'rejectMobile', true) && device.mobile) {
		return 'mobile';
	}
	return null;
};

/** Why the download must wait, or null when it may start now. */
const networkGate = (state: { attempts: number; nextAttemptAt: number }, ctx: PolicyContext, params: Params): string | null => {
	if (state.attempts >= num(params, 'maxAttempts', 3)) {
		return 'out of attempts';
	}
	if (ctx.now < state.nextAttemptAt) {
		return `retry in ${Math.ceil((state.nextAttemptAt - ctx.now) / 1000)} s`;
	}
	if (ctx.effectInUseS < num(params, 'effectInUseS', 15)) {
		return 'effect not in use long enough';
	}
	if (ctx.callUpS < num(params, 'callUpS', 30)) {
		return 'call not up long enough';
	}
	if (ctx.goodQualityForS < num(params, 'goodQualityS', 10)) {
		return 'connection quality not good long enough';
	}
	if (ctx.hidden) {
		return 'tab hidden';
	}
	if (bool(params, 'require4g', true) && ctx.effectiveType !== undefined && ctx.effectiveType !== '4g') {
		return `effectiveType ${ctx.effectiveType}`;
	}
	return null;
};

const backoffS = (attempts: number, params: Params) => [num(params, 'retry1S', 30), num(params, 'retry2S', 120), num(params, 'retry3S', 600)][Math.min(2, attempts - 1)];

const persist = (model: string, reason: string, days: number): PolicyAction => ({ type: 'persist', model, reason, days });

/** One second of watching the large model at runtime: the hysteresis and sustained windows. */
const watch = (state: Watch, ctx: PolicyContext, params: Params): Watch & { reason?: string } => {
	if (ctx.sinceSwapS < num(params, 'ignoreAfterSwapS', 3)) {
		return state;
	}
	const ratio = ctx.ratio(1);
	const lowFor = ratio === null ? state.lowFor : ratio < num(params, 'downgradeRatio', 0.8) ? state.lowFor + 1 : ratio >= num(params, 'keepRatio', 0.9) ? 0 : state.lowFor;
	let cpuStreak = 0;
	for (let i = ctx.cpuPolls.length - 1; i >= 0 && ctx.cpuPolls[i]; i--) {
		cpuStreak++;
	}
	const pressureFor = atLeast(ctx.pressure, 'serious') ? state.pressureFor + 1 : 0;
	const next = { lowFor, cpuStreak, pressureFor };
	if (lowFor >= num(params, 'downgradeSustainS', 10)) {
		return { ...next, reason: `ratio < ${num(params, 'downgradeRatio', 0.8)} for ${lowFor} s` };
	}
	if (next.cpuStreak >= num(params, 'cpuPolls', 3)) {
		return { ...next, reason: `cpu limited ${next.cpuStreak} polls` };
	}
	if (pressureFor >= num(params, 'pressureSustainS', 10)) {
		return { ...next, reason: `pressure serious for ${pressureFor} s` };
	}
	return next;
};

export const gatedPolicy = definePolicy<State>({
	id: 'gated',
	label: 'Gated upgrade',
	description: 'Device gate, network gate, runtime ratio with hysteresis, worker probe, probation, persisted verdict.',
	params: [
		{ key: 'minDeviceMemory', label: 'Device gate: min deviceMemory (GB)', kind: 'number', min: 0, max: 16, step: 1 },
		{ key: 'minCores', label: 'Device gate: min hardwareConcurrency', kind: 'number', min: 0, max: 16, step: 1 },
		{ key: 'rejectSoftwareRenderer', label: 'Device gate: reject software renderer', kind: 'boolean' },
		{ key: 'rejectSaveData', label: 'Device gate: reject saveData', kind: 'boolean' },
		{ key: 'rejectMobile', label: 'Device gate: reject mobile', kind: 'boolean' },
		{ key: 'effectInUseS', label: 'Network gate: effect in use (s)', kind: 'number', min: 0, max: 120, step: 1 },
		{ key: 'callUpS', label: 'Network gate: call up (s)', kind: 'number', min: 0, max: 300, step: 1 },
		{ key: 'goodQualityS', label: 'Network gate: good quality for (s)', kind: 'number', min: 0, max: 60, step: 1 },
		{ key: 'require4g', label: "Network gate: effectiveType '4g' where known", kind: 'boolean' },
		{ key: 'maxAttempts', label: 'Download attempts per call', kind: 'number', min: 1, max: 10, step: 1 },
		{ key: 'retry1S', label: 'Retry backoff 1 (s)', kind: 'number', min: 0, max: 600, step: 5 },
		{ key: 'retry2S', label: 'Retry backoff 2 (s)', kind: 'number', min: 0, max: 1200, step: 5 },
		{ key: 'retry3S', label: 'Retry backoff 3 (s)', kind: 'number', min: 0, max: 3600, step: 5 },
		{ key: 'candidateRatio', label: 'Upgrade when ratio >=', kind: 'number', min: 0.5, max: 1.2, step: 0.01 },
		{ key: 'candidateWindowS', label: '... over (s)', kind: 'number', min: 1, max: 60, step: 1 },
		{ key: 'noCpuLimitS', label: '... and no cpu limit for (s)', kind: 'number', min: 0, max: 120, step: 1 },
		{ key: 'probeMedianMaxMs', label: 'Probe: max median (ms)', kind: 'number', min: 1, max: 100, step: 1 },
		{ key: 'probeP90MaxMs', label: 'Probe: max p90 (ms)', kind: 'number', min: 1, max: 150, step: 1 },
		{ key: 'probationS', label: 'Probation length (s)', kind: 'number', min: 1, max: 120, step: 1 },
		{ key: 'probationDrop', label: 'Probation fails below baseline x', kind: 'number', min: 0.5, max: 1, step: 0.01 },
		{ key: 'probationWindowS', label: 'Probation ratio window (s)', kind: 'number', min: 1, max: 20, step: 1 },
		{ key: 'persistAfterS', label: 'Persist multiclass after healthy (s)', kind: 'number', min: 0, max: 600, step: 5 },
		{ key: 'downgradeRatio', label: 'Downgrade below ratio', kind: 'number', min: 0.3, max: 1, step: 0.01 },
		{ key: 'keepRatio', label: 'Hysteresis: reset at ratio >=', kind: 'number', min: 0.3, max: 1.2, step: 0.01 },
		{ key: 'downgradeSustainS', label: '... for consecutive (s)', kind: 'number', min: 1, max: 60, step: 1 },
		{ key: 'cpuPolls', label: 'Downgrade after cpu-limited polls', kind: 'number', min: 1, max: 10, step: 1 },
		{ key: 'pressureSustainS', label: 'Downgrade after pressure serious (s)', kind: 'number', min: 1, max: 60, step: 1 },
		{ key: 'ignoreAfterSwapS', label: 'Ignore metrics after a swap (s)', kind: 'number', min: 0, max: 10, step: 1 },
		{ key: 'verdictDays', label: 'Verdict lifetime (days)', kind: 'number', min: 1, max: 90, step: 1 },
		{ key: 'runtimeVerdictDays', label: 'Runtime-downgrade verdict lifetime (days)', kind: 'number', min: 1, max: 90, step: 1 },
	],
	defaults: {
		minDeviceMemory: 4,
		minCores: 4,
		rejectSoftwareRenderer: true,
		rejectSaveData: true,
		rejectMobile: true,
		effectInUseS: 15,
		callUpS: 30,
		goodQualityS: 10,
		require4g: true,
		maxAttempts: 3,
		retry1S: 30,
		retry2S: 120,
		retry3S: 600,
		candidateRatio: 0.95,
		candidateWindowS: 10,
		noCpuLimitS: 30,
		probeMedianMaxMs: 20,
		probeP90MaxMs: 28,
		probationS: 20,
		probationDrop: 0.9,
		probationWindowS: 5,
		persistAfterS: 60,
		downgradeRatio: 0.8,
		keepRatio: 0.9,
		downgradeSustainS: 10,
		cpuPolls: 3,
		pressureSustainS: 10,
		ignoreAfterSwapS: 3,
		verdictDays: 30,
		runtimeVerdictDays: 7,
	},
	start(ctx, params) {
		const verdict = ctx.verdict;
		if (verdict?.model === ctx.large && ctx.cached(ctx.large)) {
			return { state: { name: 'TRUSTED', lowFor: 0, cpuStreak: 0, pressureFor: 0 }, model: ctx.large, note: 'verdict multiclass and cached: start on it, no swap' };
		}
		if (verdict?.model === ctx.small) {
			return { state: { name: 'FINAL', reason: `verdict ${verdict.reason}` }, model: ctx.small, note: `verdict says ${verdict.model} (${verdict.reason})` };
		}
		const gate = deviceGate(ctx.device, params);
		if (gate) {
			return { state: { name: 'FINAL', reason: gate }, model: ctx.small, note: `device gate: ${gate}` };
		}
		return { state: { name: 'CANDIDATE', attempts: 0, nextAttemptAt: 0 }, model: ctx.small };
	},
	step(state, ctx, params) {
		const swapFailed = ctx.events.find((event) => event.type === 'swap' && !event.ok);
		if (swapFailed && swapFailed.type === 'swap') {
			return {
				state: { name: 'FINAL', reason: 'init-failed' },
				actions: [{ type: 'recover', model: ctx.small }, persist(ctx.small, 'init-failed', num(params, 'verdictDays', 30))],
				note: `in-place swap failed (${swapFailed.error}); new processor on ${ctx.small}`,
			};
		}
		if (ctx.hidden && state.name !== 'DOWNLOADING') {
			return { state };
		}
		switch (state.name) {
			case 'CANDIDATE': {
				const wait = networkGate(state, ctx, params);
				if (wait) {
					return { state };
				}
				const ratio = ctx.ratio(num(params, 'candidateWindowS', 10));
				const cpuRecently = ctx.lastCpuLimitedAgoS !== null && ctx.lastCpuLimitedAgoS < num(params, 'noCpuLimitS', 30);
				if (ratio === null || ratio < num(params, 'candidateRatio', 0.95) || cpuRecently || atLeast(ctx.pressure, 'serious')) {
					return { state };
				}
				return { state: { ...state, name: 'DOWNLOADING' }, actions: [{ type: 'download', model: ctx.large }], note: `ratio ${ratio.toFixed(2)}: downloading ${ctx.large}` };
			}
			case 'DOWNLOADING': {
				const done = ctx.events.find((event) => event.type === 'download');
				if (done?.type === 'download') {
					if (done.ok) {
						return { state: { name: 'PROBING', attempts: state.attempts + 1 }, actions: [{ type: 'probe', model: ctx.large }] };
					}
					const attempts = state.attempts + 1;
					const retry = backoffS(attempts, params);
					return { state: { name: 'CANDIDATE', attempts, nextAttemptAt: ctx.now + retry * 1000 }, note: `download failed (${done.error}); attempt ${attempts}, retry in ${retry} s` };
				}
				if (ctx.quality === 'poor' || ctx.quality === 'lost') {
					return { state, actions: [{ type: 'abort-download' }], note: `connection ${ctx.quality}: aborting download` };
				}
				return { state };
			}
			case 'PROBING': {
				const probe = ctx.events.find((event) => event.type === 'probe');
				if (probe?.type !== 'probe') {
					return { state };
				}
				const tooSlow = (probe.medianMs ?? 0) > num(params, 'probeMedianMaxMs', 20) || (probe.p90Ms ?? 0) > num(params, 'probeP90MaxMs', 28);
				if (!probe.ok || tooSlow) {
					const reason = probe.ok ? `probe slow (median ${probe.medianMs} ms, p90 ${probe.p90Ms} ms)` : `probe failed (${probe.error})`;
					return { state: { name: 'FINAL', reason }, actions: [persist(ctx.small, 'probe', num(params, 'verdictDays', 30))], note: reason };
				}
				const baseline = ctx.ratio(num(params, 'candidateWindowS', 10)) ?? 1;
				return { state: { name: 'SWAPPING', baseline }, actions: [{ type: 'swap', model: ctx.large }], note: `probe ok (median ${probe.medianMs} ms); baseline ratio ${baseline.toFixed(2)}` };
			}
			case 'SWAPPING': {
				const swapped = ctx.events.find((event) => event.type === 'swap' && event.ok);
				return swapped ? { state: { name: 'PROBATION', baseline: state.baseline, since: ctx.now, cpuAtStart: ctx.cpuPolls[ctx.cpuPolls.length - 1] ?? false } } : { state };
			}
			case 'PROBATION': {
				if (ctx.sinceSwapS < num(params, 'ignoreAfterSwapS', 3)) {
					return { state };
				}
				const ratio = ctx.ratio(Math.min(num(params, 'probationWindowS', 5), Math.floor(ctx.sinceSwapS - num(params, 'ignoreAfterSwapS', 3)) || 1));
				const cpuNow = ctx.cpuPolls[ctx.cpuPolls.length - 1] ?? false;
				const failed =
					ratio !== null && ratio < num(params, 'probationDrop', 0.9) * state.baseline
						? `ratio ${ratio.toFixed(2)} < ${num(params, 'probationDrop', 0.9)} x ${state.baseline.toFixed(2)}`
						: cpuNow && !state.cpuAtStart
							? 'cpu newly limited'
							: atLeast(ctx.pressure, 'serious')
								? `pressure ${ctx.pressure}`
								: null;
				if (failed) {
					return {
						state: { name: 'FINAL', reason: `probation: ${failed}` },
						actions: [{ type: 'swap', model: ctx.small }, persist(ctx.small, 'probation', num(params, 'verdictDays', 30))],
						note: `probation failed: ${failed}`,
					};
				}
				if (ctx.now - state.since >= num(params, 'probationS', 20) * 1000) {
					return { state: { name: 'MULTICLASS', since: ctx.now, persisted: false, lowFor: 0, cpuStreak: 0, pressureFor: 0 }, note: 'probation passed' };
				}
				return { state };
			}
			case 'MULTICLASS':
			case 'TRUSTED': {
				const next = watch(state, ctx, params);
				if (next.reason) {
					return {
						state: { name: 'FINAL', reason: `runtime: ${next.reason}` },
						actions: [{ type: 'swap', model: ctx.small }, persist(ctx.small, 'runtime', num(params, 'runtimeVerdictDays', 7))],
						note: `downgrade: ${next.reason}`,
					};
				}
				if (state.name === 'MULTICLASS' && !state.persisted && ctx.now - state.since >= num(params, 'persistAfterS', 60) * 1000) {
					return { state: { ...state, ...next, persisted: true }, actions: [persist(ctx.large, 'healthy', num(params, 'verdictDays', 30))], note: 'healthy: verdict multiclass persisted' };
				}
				return { state: { ...state, lowFor: next.lowFor, cpuStreak: next.cpuStreak, pressureFor: next.pressureFor } };
			}
			default:
				return { state };
		}
	},
});
