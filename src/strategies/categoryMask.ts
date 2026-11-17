import type { Strategy } from './types';

/** @livekit/track-processors with maskBlending: 'binary', its default before #162. */
export const categoryMask: Strategy = {
	id: 'category-box-blur',
	label: "Category mask + box blur (maskBlending: 'binary')",
	description: "The model's foreground or background decision (a hard cut at 0.5), box blurred, straight into the composite.",
	segmenterOutput: 'category',
	glReset: true,
	maskTargetEdge: 640,
	mask: [{ pass: 'boxBlur', enabled: true, params: { radius: 8 } }],
	frame: [],
	composite: { edgeSoftness: 2 },
};
