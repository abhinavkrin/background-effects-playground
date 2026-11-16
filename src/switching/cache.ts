import { MODELS, modelUrl, type ModelEntry } from '../models';

/** Where downloaded models are kept, as an app would cache them between calls. */
export const CACHE_NAME = 'background-effects-playground-models';

export interface CachedEntry {
	url: string;
	model?: ModelEntry;
	bytes: number;
}

const available = () => typeof caches !== 'undefined';

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const listCached = async (): Promise<CachedEntry[]> => {
	if (!available()) {
		return [];
	}
	const cache = await caches.open(CACHE_NAME);
	const entries: CachedEntry[] = [];
	for (const request of await cache.keys()) {
		const response = await cache.match(request);
		const blob = await response?.blob();
		entries.push({ url: request.url, model: MODELS.find((model) => modelUrl(model) === request.url), bytes: blob?.size ?? 0 });
	}
	return entries;
};

export const readCached = async (model: ModelEntry): Promise<Uint8Array | null> => {
	if (!available()) {
		return null;
	}
	const response = await (await caches.open(CACHE_NAME)).match(modelUrl(model));
	return response ? new Uint8Array(await response.arrayBuffer()) : null;
};

export const writeCached = async (model: ModelEntry, bytes: Uint8Array): Promise<void> => {
	if (!available()) {
		return;
	}
	const cache = await caches.open(CACHE_NAME);
	await cache.put(modelUrl(model), new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream' } }));
};

export const deleteCached = async (url: string): Promise<void> => {
	if (available()) {
		await (await caches.open(CACHE_NAME)).delete(url);
	}
};

export const clearCache = async (): Promise<void> => {
	if (available()) {
		await caches.delete(CACHE_NAME);
	}
};

/** Whether a cached entry still matches the model registry's SHA-256. */
export const verifyCached = async (entry: CachedEntry): Promise<{ ok: boolean; sha256: string }> => {
	const response = await (await caches.open(CACHE_NAME)).match(entry.url);
	const sha256 = response ? await sha256Hex(new Uint8Array(await response.arrayBuffer())) : '';
	return { ok: !!entry.model && sha256 === entry.model.sha256, sha256 };
};
