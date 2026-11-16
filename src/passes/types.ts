import type { ParamSpec, Params } from '../lib/params';

/**
 * Where a pass runs.
 * - `mask`: once per segmentation result, on the mask (sized from the frame, long edge about 640 px).
 * - `frame`: once per output frame, after the frame is uploaded, before the composite; can read the frame.
 */
export type PassStage = 'mask' | 'frame';

/** What a pass sees besides its input texture. */
export interface PassContext {
	gl: WebGL2RenderingContext;
	vertexBuffer: WebGLBuffer;
	maskWidth: number;
	maskHeight: number;
	/** Frame pixels per mask texel; the library scales mask-space radii by it. */
	maskDownsampleFactor: number;
	/** The current frame, uploaded unflipped; in the mask stage it is the frame that was segmented. */
	frameTexture: WebGLTexture;
	frameWidth: number;
	frameHeight: number;
	/** Whether the model's first mask is background (multiclass) rather than the person. */
	maskIsBackground: boolean;
}

export interface PassInstance {
	/** Renders `input` into a texture the pass owns and returns it. Must not flip the image vertically. */
	run(ctx: PassContext, input: WebGLTexture, params: Params): WebGLTexture;
	/** Forgets history (the temporal pass's previous mask). */
	reset?(): void;
	dispose(): void;
}

export interface PassDefinition {
	id: string;
	label: string;
	stage: PassStage;
	description: string;
	params: readonly ParamSpec[];
	defaults: Params;
	create(gl: WebGL2RenderingContext): PassInstance;
}

/** One entry of a strategy's pass list. */
export interface PassConfig {
	pass: string;
	enabled: boolean;
	params: Params;
}
