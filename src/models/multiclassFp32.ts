import type { ModelEntry } from './types';

export const multiclassFp32: ModelEntry = {
	id: 'selfie-multiclass-fp32',
	label: 'Selfie multiclass fp32 (15.6 MB)',
	file: 'selfie_multiclass_256x256_fp32.tflite',
	bytes: 16371837,
	sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0',
	input: { width: 256, height: 256 },
	maskLayout: 'background-first',
	labels: ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'],
	precision: 'float32',
	origin: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
	notes: "Google's original; the fp16 file is this one with float16 weights. Kept to compare the two.",
};
