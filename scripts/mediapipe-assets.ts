import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serves the MediaPipe runtime from the installed @mediapipe/tasks-vision, never from a CDN: the wasm files the
 * segmenter loads, and the classic-script bundle the warm-up worker imports.
 */
export const mediapipeAssets = (publicDir: string): Plugin => ({
	name: 'playground:mediapipe-assets',
	buildStart() {
		// The package's exports map hides package.json, so locate it from the project root.
		const packageDir = join(dirname(publicDir), 'node_modules', '@mediapipe', 'tasks-vision');
		const target = join(publicDir, 'mediapipe');
		mkdirSync(join(target, 'wasm'), { recursive: true });
		const copies: Array<[string, string]> = [
			['wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.js'],
			['wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.wasm'],
			['wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.js'],
			['wasm/vision_wasm_nosimd_internal.wasm', 'wasm/vision_wasm_nosimd_internal.wasm'],
			// A worker's importScripts needs a JavaScript MIME type, which a .cjs file does not always get.
			['vision_bundle.cjs', 'vision_bundle_cjs.js'],
		];
		for (const [from, to] of copies) {
			const source = join(packageDir, from);
			const destination = join(target, to);
			if (existsSync(destination) && statSync(destination).size === statSync(source).size && statSync(destination).mtimeMs >= statSync(source).mtimeMs) {
				continue;
			}
			cpSync(source, destination);
		}
	},
});
