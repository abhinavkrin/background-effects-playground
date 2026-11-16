import type { ModelEntry } from './types';

export const multiclassFp16: ModelEntry = {
	id: 'selfie-multiclass-fp16',
	label: 'Selfie multiclass fp16 (8.3 MB)',
	file: 'selfie_multiclass_256x256_fp16.tflite',
	bytes: 8268241,
	sha256: '3e3b6ae9c1c1cd2307c9355d2075998fdca8e1a2f95936634169d4f544127830',
	input: { width: 256, height: 256 },
	maskLayout: 'background-first',
	labels: ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'],
	precision: 'float16',
	origin: 'tools/fp16_convert.py applied to https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
	notes: 'Best quality: clean fingers and hair, furniture stays in the background. Its weights converted from float32 to float16, half the download.',
};
