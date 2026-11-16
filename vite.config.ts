import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mediapipeAssets } from './scripts/mediapipe-assets';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));

// Loopback only: nothing on the network needs the dev server.
const host = '127.0.0.1';

export default defineConfig({
	// Served from https://<user>.github.io/background-effects-playground/.
	base: '/background-effects-playground/',
	plugins: [react(), mediapipeAssets(publicDir)],
	publicDir,
	server: { host, port: 5199, strictPort: true },
	preview: { host, port: 5198, strictPort: true },
	build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
