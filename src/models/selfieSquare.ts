import type { ModelEntry } from './types';

export const selfieSquare: ModelEntry = {
	id: 'selfie-square',
	label: 'Selfie square (250 KB)',
	file: 'selfie_segmenter_square.tflite',
	bytes: 249537,
	sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b',
	input: { width: 256, height: 256 },
	maskLayout: 'person',
	labels: ['selfie'],
	precision: 'float16',
	origin: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
	notes: "The library's default model. A 16:9 frame is squashed into 256x256.",
};
