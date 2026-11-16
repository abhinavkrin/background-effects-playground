import type { Params } from '../lib/params';
import type { PassConfig } from '../passes/types';

/** A named rendering pipeline for the lab engine: segmenter output, the passes in order, and their parameters. */
export interface Strategy {
	id: string;
	label: string;
	description: string;
	/** Category mask (the library's hard cut at 0.5) or the confidence masks. */
	segmenterOutput: 'confidence' | 'category';
	/** Restore the GL state MediaPipe may leave behind, before the mask passes and before the frame passes. */
	glReset: boolean;
	/** Long edge of the mask buffers in pixels; the library uses 640. */
	maskTargetEdge: number;
	/** Run on each segmentation result, in order. */
	mask: PassConfig[];
	/** Run on each frame before the composite, in order; they can read the frame. */
	frame: PassConfig[];
	/** Composite parameters (see passes/composite.ts). */
	composite: Params;
}
