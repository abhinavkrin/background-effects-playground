// Builds the given model's graph once on a canvas of its own, so the GPU process has compiled its shaders before the
// live segmenter switches to it, and a file that cannot load fails here instead of in the live wasm module.
// A classic worker: MediaPipe loads its wasm loader with importScripts. Plain JS because public/ is served as is.

// The CommonJS bundle writes its exports here.
self.exports = {};
// The mask readback asks the page whether it is iOS ('ontouchend' in document); a worker has no page.
const probeDocument = {};

onmessage = async ({ data: { bytes, base, bundle } }) => {
	const t0 = performance.now();
	try {
		importScripts(bundle);
		const { FilesetResolver, ImageSegmenter } = self.exports;
		const fileSet = await FilesetResolver.forVisionTasks(base);
		const canvas = new OffscreenCanvas(1, 1);
		const segmenter = await ImageSegmenter.createFromOptions(fileSet, {
			baseOptions: { modelAssetBuffer: bytes, delegate: 'GPU' },
			canvas,
			runningMode: 'VIDEO',
			outputCategoryMask: false,
			outputConfidenceMasks: true,
		});
		const t1 = performance.now();
		const image = new ImageData(320, 180);
		let firstInferenceMs;
		const r0 = performance.now();
		segmenter.segmentForVideo(image, performance.now(), (result) => {
			firstInferenceMs = performance.now() - r0;
			result.close();
		});
		const r1 = performance.now();
		segmenter.segmentForVideo(image, performance.now() + 1, (result) => result.close());
		const secondInferenceMs = performance.now() - r1;
		// Inference as the GPU does it: reading the mask back waits for the work to finish.
		self.document = probeDocument;
		const times = [];
		for (let i = 0; i < 20; i++) {
			const s0 = performance.now();
			segmenter.segmentForVideo(image, performance.now() + 10 + i, (result) => {
				result.confidenceMasks[0].getAsFloat32Array();
				result.close();
			});
			times.push(performance.now() - s0);
		}
		times.sort((a, b) => a - b);
		segmenter.close();
		postMessage({
			ok: true,
			createMs: Math.round(t1 - t0),
			firstInferenceMs: Math.round(firstInferenceMs),
			secondInferenceMs: Math.round(secondInferenceMs),
			readbackMedianMs: +times[10].toFixed(1),
			readbackP90Ms: +times[18].toFixed(1),
		});
	} catch (e) {
		postMessage({ ok: false, error: String(e).slice(0, 300) });
	}
};
