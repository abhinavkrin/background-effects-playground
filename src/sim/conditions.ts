import { Store } from '../lib/store';

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost';
export type PressureState = 'nominal' | 'fair' | 'serious' | 'critical';

/** Conditions the switching policies react to, real or simulated. `null` means "use the real value". */
export interface Conditions {
	/** Busy-wait on the main thread after every processed frame, in ms. */
	cpuBusyMs: number;
	/** Extra no-op GPU passes per frame, and how heavy each is. */
	gpuExtraPasses: number;
	gpuIterations: number;
	/** Cap on the input frame rate (0 = the source's own). */
	inputFpsCap: number;
	/** Measure GPU time with a forced readback each frame (costs throughput). */
	gpuProbe: boolean;

	deviceMemory: number | null;
	hardwareConcurrency: number | null;
	renderer: string | null;
	saveData: boolean | null;
	mobile: boolean | null;
	effectiveType: string | null;

	connectionQuality: ConnectionQuality;
	cpuLimited: boolean;
	pressure: PressureState | null;
	tabHidden: boolean;

	/** Simulated network for model downloads. */
	downloadKbps: number;
	downloadLatencyMs: number;
	downloadFailAtPercent: number;
	downloadTruncatePercent: number;
	downloadCorrupt: boolean;
	skipHashCheck: boolean;
	skipWorkerProbe: boolean;
}

export const DEFAULT_CONDITIONS: Conditions = {
	cpuBusyMs: 0,
	gpuExtraPasses: 0,
	gpuIterations: 64,
	inputFpsCap: 0,
	gpuProbe: false,
	deviceMemory: null,
	hardwareConcurrency: null,
	renderer: null,
	saveData: null,
	mobile: null,
	effectiveType: null,
	connectionQuality: 'excellent',
	cpuLimited: false,
	pressure: null,
	tabHidden: false,
	// About 2 Mbps, so a download does not starve the call.
	downloadKbps: 2000,
	downloadLatencyMs: 0,
	downloadFailAtPercent: 0,
	downloadTruncatePercent: 0,
	downloadCorrupt: false,
	skipHashCheck: false,
	skipWorkerProbe: false,
};

export const conditions = new Store<Conditions>({ ...DEFAULT_CONDITIONS });

/** Spins the main thread, standing in for a slow CPU. */
export const busyWait = (ms: number): void => {
	if (ms <= 0) {
		return;
	}
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// spin
	}
};
