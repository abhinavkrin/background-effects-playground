import { modelUrl, type ModelEntry } from '../models';
import type { Conditions } from '../sim/conditions';
import { sha256Hex, writeCached } from './cache';

export interface DownloadProgress {
	received: number;
	total: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const id = setTimeout(resolve, ms);
		signal.addEventListener('abort', () => {
			clearTimeout(id);
			reject(new DOMException('aborted', 'AbortError'));
		});
	});

/**
 * Downloads a model without disturbing the call: low priority, no HTTP cache, read through a reader paced to a
 * target rate (pausing reads applies TCP backpressure), then length and SHA-256 checked and stored in Cache Storage.
 * The simulator can slow it, fail it part way, truncate it or corrupt it.
 */
export const downloadModel = async (
	model: ModelEntry,
	network: Pick<Conditions, 'downloadKbps' | 'downloadLatencyMs' | 'downloadFailAtPercent' | 'downloadTruncatePercent' | 'downloadCorrupt' | 'skipHashCheck'>,
	signal: AbortSignal,
	onProgress: (progress: DownloadProgress) => void,
): Promise<Uint8Array> => {
	if (network.downloadLatencyMs > 0) {
		await sleep(network.downloadLatencyMs, signal);
	}
	const response = await fetch(modelUrl(model), { priority: 'low', cache: 'no-store', signal } as RequestInit);
	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status}`);
	}
	const total = Number(response.headers.get('content-length')) || model.bytes;
	const stopAt = network.downloadTruncatePercent > 0 ? Math.floor((total * network.downloadTruncatePercent) / 100) : Infinity;
	const failAt = network.downloadFailAtPercent > 0 ? Math.floor((total * network.downloadFailAtPercent) / 100) : Infinity;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	const started = performance.now();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const room = stopAt - received;
			chunks.push(room < value.length ? value.subarray(0, Math.max(0, room)) : value);
			received += Math.min(value.length, Math.max(0, room));
			onProgress({ received, total });
			if (received >= failAt) {
				throw new Error(`simulated network failure at ${network.downloadFailAtPercent}%`);
			}
			if (received >= stopAt) {
				break;
			}
			if (network.downloadKbps > 0) {
				const due = (received * 8) / network.downloadKbps;
				const ahead = due - (performance.now() - started);
				if (ahead > 0) {
					await sleep(ahead, signal);
				}
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	if (network.downloadCorrupt && bytes.length > 1024) {
		const middle = Math.floor(bytes.length / 2);
		for (let i = middle; i < middle + 256; i++) {
			bytes[i] ^= 0xff;
		}
	}
	if (!network.skipHashCheck) {
		if (bytes.length !== model.bytes) {
			throw new Error(`length ${bytes.length}, expected ${model.bytes}`);
		}
		const sha256 = await sha256Hex(bytes);
		if (sha256 !== model.sha256) {
			throw new Error(`SHA-256 mismatch (${sha256.slice(0, 12)}...)`);
		}
	}
	await writeCached(model, bytes);
	return bytes;
};
