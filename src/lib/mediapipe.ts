import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { ImageSegmenterOptions } from '@mediapipe/tasks-vision';

/** The MediaPipe runtime, copied from node_modules by the mediapipe-assets Vite plugin. */
export const WASM_BASE = new URL('mediapipe/wasm', document.baseURI).href;

export const VISION_BUNDLE_URL = new URL('mediapipe/vision_bundle_cjs.js', document.baseURI).href;

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let fileset: Promise<Fileset> | undefined;

export const visionFileset = (): Promise<Fileset> => (fileset ??= FilesetResolver.forVisionTasks(WASM_BASE));

export type SegmenterOutput = 'confidence' | 'category';

export const outputOptions = (output: SegmenterOutput): Pick<ImageSegmenterOptions, 'outputCategoryMask' | 'outputConfidenceMasks'> => ({
	outputCategoryMask: output === 'category',
	outputConfidenceMasks: output === 'confidence',
});

/** A GPU segmenter that renders into `canvas`'s WebGL2 context, built from a URL or from bytes. */
export const createSegmenter = async (
	canvas: OffscreenCanvas | HTMLCanvasElement,
	model: { url: string } | { bytes: Uint8Array },
	output: SegmenterOutput,
): Promise<ImageSegmenter> =>
	ImageSegmenter.createFromOptions(await visionFileset(), {
		baseOptions: 'bytes' in model ? { modelAssetBuffer: model.bytes, delegate: 'GPU' } : { modelAssetPath: model.url, delegate: 'GPU' },
		canvas,
		runningMode: 'VIDEO',
		...outputOptions(output),
	});

const heapPaths = new WeakMap<object, string[]>();

/**
 * Bytes of the segmenter's wasm heap. MediaPipe 0.10.14 keeps the Emscripten module in minified fields, so this
 * looks for HEAPU8 one or two levels down instead of naming them.
 */
export const wasmHeapBytes = (segmenter: unknown): number | undefined => {
	if (!segmenter || typeof segmenter !== 'object') {
		return undefined;
	}
	const read = (path: string[]) => {
		let value: unknown = segmenter;
		for (const key of path) {
			value = (value as Record<string, unknown> | undefined)?.[key];
		}
		const heap = (value as { HEAPU8?: unknown } | undefined)?.HEAPU8;
		return heap instanceof Uint8Array ? heap.byteLength : undefined;
	};
	const known = heapPaths.get(segmenter);
	if (known) {
		return read(known);
	}
	const search = (value: unknown, path: string[]): string[] | undefined => {
		if (!value || typeof value !== 'object') {
			return undefined;
		}
		if ((value as { HEAPU8?: unknown }).HEAPU8 instanceof Uint8Array) {
			return path;
		}
		if (path.length >= 2) {
			return undefined;
		}
		for (const key of Object.keys(value)) {
			const found = search((value as Record<string, unknown>)[key], [...path, key]);
			if (found) {
				return found;
			}
		}
		return undefined;
	};
	const path = search(segmenter, []);
	if (!path) {
		return undefined;
	}
	heapPaths.set(segmenter, path);
	return read(path);
};

export const jsHeapBytes = (): number | undefined => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
