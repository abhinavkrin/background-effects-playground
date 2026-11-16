import type { PassConfig } from '../passes/types';
import type { Strategy } from './types';

const ADAPTIVE = { stillWeight: 0.15, movingWeight: 0.9, motionLow: 0.035, motionHigh: 0.14, probeStep: 2 };

const toBackground: PassConfig = { pass: 'normalize', enabled: true, params: {} };
const boxBlur: PassConfig = { pass: 'boxBlur', enabled: true, params: { radius: 8 } };
const adaptiveBlend: PassConfig = { pass: 'adaptiveTemporal', enabled: true, params: { ...ADAPTIVE } };
const edgeRefinement: PassConfig = { pass: 'bilateral', enabled: true, params: { radius: 4, step: 2, spatialSigma: 3, rangeSigma: 0.1 } };

const base = { segmenterOutput: 'confidence', glReset: true, maskTargetEdge: 640 } as const;

/** What the library does with segmentationMask 'confidence', temporalSmoothing and edgeRefinement. */
export const confidenceAdaptiveEdges: Strategy = {
	...base,
	id: 'confidence-adaptive-edges',
	label: 'Confidence mask + box blur + motion-adaptive EMA + joint bilateral',
	description: 'Confidence mask, box blur 8, blend with the previous mask (0.15 of the new one where still, up to 0.90 where moving), then a joint bilateral filter guided by the frame.',
	mask: [toBackground, boxBlur, adaptiveBlend],
	frame: [edgeRefinement],
	composite: { edgeSoftness: 2 },
};

export const confidenceAdaptive: Strategy = {
	...base,
	id: 'confidence-adaptive',
	label: 'Confidence mask + box blur + motion-adaptive EMA',
	description: 'As with all options on, without edge refinement: shows what the bilateral filter adds at hair and fingers.',
	mask: [toBackground, boxBlur, adaptiveBlend],
	frame: [],
	composite: { edgeSoftness: 2 },
};

export const confidenceEdges: Strategy = {
	...base,
	id: 'confidence-edges',
	label: 'Confidence mask + box blur + joint bilateral',
	description: 'As with all options on, without the temporal blend: shows the flicker the blend removes.',
	mask: [toBackground, boxBlur],
	frame: [edgeRefinement],
	composite: { edgeSoftness: 2 },
};

export const confidenceFixedEdges: Strategy = {
	...base,
	id: 'confidence-fixed-edges',
	label: 'Confidence mask + box blur + fixed EMA 0.4 + joint bilateral',
	description: 'The temporal blend at a fixed 0.4 of the new mask everywhere: steadier still edges than none, but trails fast movement.',
	mask: [toBackground, boxBlur, { pass: 'temporal', enabled: true, params: { weight: 0.4 } }],
	frame: [edgeRefinement],
	composite: { edgeSoftness: 2 },
};

export const confidenceOnly: Strategy = {
	...base,
	id: 'confidence-only',
	label: 'Confidence mask + box blur',
	description: 'The confidence mask in place of the category mask and nothing else: segmentationMask alone.',
	mask: [toBackground, boxBlur],
	frame: [],
	composite: { edgeSoftness: 2 },
};

export const confidenceOpacity: Strategy = {
	...base,
	id: 'confidence-opacity',
	label: 'Confidence as alpha (linear blend, no 0.5 cut)',
	description: 'Blends frame and background by the background probability itself instead of a cut at 0.5. No temporal blend or edge refinement.',
	mask: [toBackground, boxBlur],
	frame: [],
	composite: { edgeSoftness: 2, confidenceAsOpacity: true },
};

/** https://github.com/livekit/track-processors-js/pull/135 as written. */
export const adaptiveEdgeFloor: Strategy = {
	...base,
	id: 'adaptive-edge-floor',
	label: 'Confidence mask + box blur + motion-adaptive EMA + smoothstep floor (#135)',
	description: 'livekit/track-processors-js#135: the motion-adaptive blend with a 0.015 floor on the edge half-width. No edge refinement.',
	mask: [toBackground, boxBlur, adaptiveBlend],
	frame: [],
	composite: { edgeSoftness: 2, edgeMinHalfWidth: 0.015 },
};
