import type { PassConfig } from '../passes/types';
import type { Strategy } from './types';

const ADAPTIVE = { stillWeight: 0.15, movingWeight: 0.9, motionLow: 0.035, motionHigh: 0.14, probeStep: 2 };

const toBackground: PassConfig = { pass: 'normalize', enabled: true, params: {} };
const boxBlur: PassConfig = { pass: 'boxBlur', enabled: true, params: { radius: 8 } };
const adaptiveBlend: PassConfig = { pass: 'adaptiveTemporal', enabled: true, params: { ...ADAPTIVE } };
const edgeRefinement: PassConfig = { pass: 'bilateral', enabled: true, params: { radius: 4, step: 2, spatialSigma: 3, rangeSigma: 0.1 } };

const base = { segmenterOutput: 'confidence', glReset: true, maskTargetEdge: 640 } as const;

/** temporalSmoothing and edgeRefinement on a confidence mask that is still cut at 0.5, as before alpha blending. */
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
	description: 'The confidence mask in place of the category mask and nothing else, still cut at 0.5.',
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

/** livekit/track-processors-js#162's alpha blending, with temporalSmoothing and edgeRefinement on as well. */
export const alphaBlending: Strategy = {
	...base,
	id: 'alpha-blending',
	label: 'Confidence as alpha + box blur 4 + motion-adaptive EMA + joint bilateral (#162)',
	description: "livekit/track-processors-js#162 with all options on: the person's confidence is each pixel's opacity (no cut at 0.5), the mask box blurred at 4, blended with the previous mask, then refined by a joint bilateral filter.",
	mask: [toBackground, { pass: 'boxBlur', enabled: true, params: { radius: 4 } }, adaptiveBlend],
	frame: [edgeRefinement],
	composite: { edgeSoftness: 2, confidenceAsOpacity: true },
};

/** alphaBlending with the confidence remapped through a smoothstep, so faint ghosts drop out and the body is fully solid. */
export const alphaBlendingSmoothstep: Strategy = {
	...alphaBlending,
	id: 'alpha-blending-smoothstep',
	label: 'Confidence as alpha, smoothstep 0.15 to 0.85 + box blur 4 + motion-adaptive EMA + joint bilateral',
	description: "As #162 with all options on, but the person's confidence goes through smoothstep(0.15, 0.85) before it is used as opacity: below 0.15 is fully transparent, above 0.85 fully solid.",
	composite: { ...alphaBlending.composite, alphaLow: 0.15, alphaHigh: 0.85, alphaCurve: 'smoothstep' },
};

/** alphaBlendingSmoothstep without the joint bilateral, to see what edgeRefinement adds on its own. */
export const alphaBlendingSmoothstepNoBilateral: Strategy = {
	...alphaBlendingSmoothstep,
	id: 'alpha-blending-smoothstep-no-bilateral',
	label: 'Confidence as alpha, smoothstep 0.15 to 0.85 + box blur 4 + motion-adaptive EMA',
	description: 'As the smoothstep preset, but without the joint bilateral filter (edgeRefinement off). Compare the two to see what edge refinement does.',
	frame: [],
};
