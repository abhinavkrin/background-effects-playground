import { multiclassFp16 } from './multiclassFp16';
import { selfieLandscape } from './selfieLandscape';
import { selfieSquare } from './selfieSquare';
import type { ModelEntry } from './types';

export type { MaskLayout, ModelEntry } from './types';

/** Every model the playground can load, in the order the pickers show them. */
export const MODELS: readonly ModelEntry[] = [selfieLandscape, multiclassFp16, selfieSquare];

/** The two models the switching research is about. */
export const SMALL_MODEL_ID = selfieLandscape.id;
export const LARGE_MODEL_ID = multiclassFp16.id;

export const modelById = (id: string): ModelEntry => {
	const model = MODELS.find((entry) => entry.id === id);
	if (!model) {
		throw new Error(`unknown model ${id}`);
	}
	return model;
};

export const modelUrl = (model: ModelEntry): string => new URL(`models/${model.file}`, document.baseURI).href;

const loaded = new Map<string, Promise<Uint8Array>>();

/** The model's bytes, fetched once per page straight from the dev server (no simulated network). */
export const loadModelBytes = (model: ModelEntry): Promise<Uint8Array> => {
	let bytes = loaded.get(model.id);
	if (!bytes) {
		bytes = fetch(modelUrl(model)).then(async (response) => {
			if (!response.ok) {
				throw new Error(`${model.file}: HTTP ${response.status}`);
			}
			return new Uint8Array(await response.arrayBuffer());
		});
		bytes.catch(() => loaded.delete(model.id));
		loaded.set(model.id, bytes);
	}
	return bytes;
};
