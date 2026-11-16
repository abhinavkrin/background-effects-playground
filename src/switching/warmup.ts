import { VISION_BUNDLE_URL, WASM_BASE } from '../lib/mediapipe';

export interface ProbeResult {
	ok: boolean;
	error?: string;
	/** createFromOptions in the worker: wasm instantiation plus graph build and shader compile. */
	createMs?: number;
	firstInferenceMs?: number;
	secondInferenceMs?: number;
	/** Inference timed with a forced mask readback at 320x180, as a measure of GPU cost. */
	readbackMedianMs?: number;
	readbackP90Ms?: number;
	/** Wall time of the whole probe, worker start to result. */
	totalMs: number;
}

const WORKER_URL = new URL('workers/warm-worker.js', document.baseURI).href;

/**
 * Builds the model once in a classic Worker with a throwaway segmenter: compiles its GPU shaders away from the live
 * segmenter and proves the file loads, so a bad file cannot kill the live wasm module.
 */
export const probeInWorker = (bytes: Uint8Array, timeoutMs = 60_000): Promise<ProbeResult> =>
	new Promise((resolve) => {
		const started = performance.now();
		const worker = new Worker(WORKER_URL);
		const finish = (result: Omit<ProbeResult, 'totalMs'>) => {
			clearTimeout(timer);
			worker.terminate();
			resolve({ ...result, totalMs: performance.now() - started });
		};
		const timer = setTimeout(() => finish({ ok: false, error: 'worker timeout' }), timeoutMs);
		worker.onerror = (event) => finish({ ok: false, error: `worker error: ${event.message}` });
		worker.onmessage = (event: MessageEvent<Omit<ProbeResult, 'totalMs'>>) => finish(event.data);
		worker.postMessage({ bytes: bytes.slice(), base: WASM_BASE, bundle: VISION_BUNDLE_URL });
	});
