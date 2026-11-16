import type { ParamSpec, Params } from '../lib/params';
import type { ConnectionQuality, PressureState } from '../sim/conditions';
import type { Verdict } from './verdict';

/** What the device says about itself, after the simulator's overrides. A missing signal means "no opinion". */
export interface DeviceSignals {
	renderer: string;
	deviceMemory?: number;
	hardwareConcurrency?: number;
	saveData?: boolean;
	mobile?: boolean;
}

/** What a policy knows when an effect starts, before any frame. */
export interface PolicyStartContext {
	device: DeviceSignals;
	/** The model every effect can start on (shipped with the app). */
	small: string;
	/** The model worth upgrading to. */
	large: string;
	cached: (modelId: string) => boolean;
	verdict: Verdict | null;
}

/** What a policy sees on each tick (once a second). */
export interface PolicyContext extends PolicyStartContext {
	now: number;
	callUpS: number;
	effectInUseS: number;
	hidden: boolean;
	/** Seconds since the last model swap; throughput right after a swap is not representative. */
	sinceSwapS: number;
	/** Processed / input frames over the last `seconds` whole seconds. */
	ratio: (seconds: number) => number | null;
	/** qualityLimitationReason === 'cpu' polls (every 2 s), oldest first. */
	cpuPolls: readonly boolean[];
	/** Seconds since a poll last said cpu, or null if none has. */
	lastCpuLimitedAgoS: number | null;
	pressure: PressureState | null;
	quality: ConnectionQuality;
	/** How long the connection quality has been good or excellent. */
	goodQualityForS: number;
	effectiveType?: string;
	activeModel: string;
	downloading: boolean;
	/** Results of the actions the policy asked for, since the previous tick. */
	events: readonly PolicyEvent[];
}

export type PolicyAction =
	| { type: 'download'; model: string }
	| { type: 'abort-download' }
	| { type: 'probe'; model: string }
	| { type: 'swap'; model: string }
	/** A new processor on `model`, the only way back after a failed in-place swap killed the wasm module. */
	| { type: 'recover'; model: string }
	| { type: 'persist'; model: string; reason: string; days: number };

export type PolicyEvent =
	| { type: 'download'; ok: boolean; model: string; error?: string }
	| { type: 'probe'; ok: boolean; model: string; medianMs?: number; p90Ms?: number; error?: string }
	| { type: 'swap'; ok: boolean; model: string; error?: string }
	| { type: 'recover'; ok: boolean; model: string; error?: string };

export interface PolicyStateBase {
	/** Shown on the timeline. */
	name: string;
}

export interface PolicyStep<S extends PolicyStateBase> {
	state: S;
	actions?: PolicyAction[];
	/** One line for the event log, when something worth saying happened. */
	note?: string;
}

/**
 * A model-switching policy: a small state machine stepped once a second. It never touches the engine; it asks for
 * actions, and the runner feeds their results back as events on a later tick.
 */
export interface SwitchingPolicy<S extends PolicyStateBase = PolicyStateBase> {
	id: string;
	label: string;
	description: string;
	params: readonly ParamSpec[];
	defaults: Params;
	start(ctx: PolicyStartContext, params: Params): { state: S; model: string; note?: string; actions?: PolicyAction[] };
	step(state: S, ctx: PolicyContext, params: Params): PolicyStep<S>;
}

/** Erases a policy's own state type so policies can share one registry. */
export const definePolicy = <S extends PolicyStateBase>(policy: SwitchingPolicy<S>): SwitchingPolicy => policy as unknown as SwitchingPolicy;
