import { rendererOf } from '../passes/gl';
import { conditions, type PressureState } from '../sim/conditions';
import type { DeviceSignals } from './types';

type NavigatorSignals = Navigator & {
	deviceMemory?: number;
	connection?: { saveData?: boolean; effectiveType?: string };
	userAgentData?: { mobile?: boolean };
};

let realRenderer: string | undefined;

/** The real WebGL renderer string, read once from a throwaway context. */
export const realRendererString = (): string => {
	if (realRenderer === undefined) {
		const gl = document.createElement('canvas').getContext('webgl2');
		realRenderer = gl ? rendererOf(gl) : 'no webgl2';
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	}
	return realRenderer;
};

/** The device signals the policy's gate reads, with the simulator's overrides applied. */
export const deviceSignals = (): DeviceSignals => {
	const nav = navigator as NavigatorSignals;
	const c = conditions.get();
	return {
		renderer: c.renderer ?? realRendererString(),
		deviceMemory: c.deviceMemory ?? nav.deviceMemory,
		hardwareConcurrency: c.hardwareConcurrency ?? nav.hardwareConcurrency,
		saveData: c.saveData ?? nav.connection?.saveData,
		mobile: c.mobile ?? nav.userAgentData?.mobile,
	};
};

export const effectiveType = (): string | undefined => conditions.get().effectiveType ?? (navigator as NavigatorSignals).connection?.effectiveType;

export const isHidden = (): boolean => document.hidden || conditions.get().tabHidden;

let realPressure: PressureState | null = null;

/** Starts listening to the Compute Pressure API where it exists (Chromium 125+). */
export const observePressure = (): void => {
	const Observer = (globalThis as { PressureObserver?: new (cb: (records: Array<{ state: PressureState }>) => void) => { observe(source: string): Promise<void> } }).PressureObserver;
	if (!Observer) {
		return;
	}
	try {
		void new Observer((records) => {
			realPressure = records[records.length - 1]?.state ?? realPressure;
		})
			.observe('cpu')
			.catch(() => undefined);
	} catch {
		// unsupported here
	}
};

export const pressure = (): PressureState | null => conditions.get().pressure ?? realPressure;
