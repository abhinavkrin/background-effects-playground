import type { ModelEntry } from './types';

export const selfieLandscape: ModelEntry = {
	id: 'selfie-landscape',
	label: 'Selfie landscape (250 KB)',
	file: 'selfie_segmenter_landscape.tflite',
	bytes: 250177,
	sha256: '490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e',
	input: { width: 256, height: 144 },
	maskLayout: 'person',
	labels: ['selfie'],
	precision: 'float16',
	origin: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
	notes: 'Fast; parts of the body can pop in and out at the edges.',
};
