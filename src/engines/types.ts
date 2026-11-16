import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { ModelEntry } from '../models';
import type { BackgroundSetting } from '../passes/background';
import type { ViewMode } from '../passes/composite';
import type { Strategy } from '../strategies';

/** `lab`: the editable pipeline. `stock` and `proposed`: @livekit/track-processors itself (see LibraryEngine). */
export type EngineKind = 'lab' | LibraryBuild;

export type LibraryBuild = 'stock' | 'proposed';

/** The options the proposed build adds to BackgroundProcessor. */
export interface LibraryOptions {
	segmentationMask: 'category' | 'confidence';
	temporalSmoothing: boolean;
	edgeRefinement: boolean;
}

export const PROPOSED_DEFAULTS: LibraryOptions = { segmentationMask: 'confidence', temporalSmoothing: true, edgeRefinement: true };

export const ENGINE_LABELS: Record<EngineKind, string> = {
	stock: 'Library main',
	proposed: 'Library, proposed',
	lab: 'Editable pipeline',
};

/**
 * How a running engine moves to another model.
 * - `in-place`: `imageSegmenter.setOptions({ baseOptions: { modelAssetBuffer } })`.
 * - `restart`: a new processor / pipeline, as `track.setProcessor` does (a raw frame and a long gap).
 * - `second-segmenter`: a new ImageSegmenter on the same canvas, then the reference flips (loads a second wasm module).
 */
export type SwitchMethod = 'in-place' | 'restart' | 'second-segmenter';

export const SWITCH_METHODS: ReadonlyArray<{ id: SwitchMethod; label: string }> = [
	{ id: 'in-place', label: 'In place (setOptions)' },
	{ id: 'restart', label: 'Restart (setProcessor-style)' },
	{ id: 'second-segmenter', label: 'Second segmenter' },
];

/** One output frame, as the engine saw it. */
export interface FrameReport {
	/** performance.now() when the frame was handed on. */
	at: number;
	/** Main-thread time spent on the frame (library engines: the library's processingTimeMs). */
	frameMs: number;
	/** Time inside segmentForVideo; about 1 ms on GPU because masks stay textures. */
	segmentationMs: number;
	/** Wait for the GPU to drain, when the readback probe is on. */
	gpuProbeMs?: number;
	/** Went out without the effect: no segmenter yet, or the first frame of a restarted processor. */
	raw?: boolean;
	error?: string;
}

export interface EngineInit {
	model: ModelEntry;
	/** Build the segmenter from these bytes instead of the model's URL. */
	bytes?: Uint8Array;
	strategy: Strategy;
	background: BackgroundSetting;
	view: ViewMode;
	/** Source size, so the first frames do not reallocate everything. */
	width: number;
	height: number;
}

export interface SwitchReport {
	method: SwitchMethod;
	from: string;
	to: string;
	startedAt: number;
	/** How long the switching call itself took. */
	callMs: number;
	ok: boolean;
	error?: string;
	heapBefore?: number;
	heapAfter?: number;
}

export interface Engine {
	readonly kind: EngineKind;
	/** The element the pane shows; it holds the latest output. */
	readonly element: HTMLCanvasElement | HTMLVideoElement;
	/** Whether the debug views (masks, overlay) are available. */
	readonly supportsViews: boolean;
	readonly modelId: string;
	onFrame: (report: FrameReport) => void;
	init(init: EngineInit): Promise<void>;
	/** Processes one input frame. The caller closes `frame` after every engine has had it. */
	push(frame: VideoFrame): void;
	setBackground(background: BackgroundSetting): Promise<void>;
	setStrategy(strategy: Strategy): Promise<void>;
	setView(view: ViewMode): void;
	switchModel(model: ModelEntry, bytes: Uint8Array, method: SwitchMethod): Promise<SwitchReport>;
	/** The live segmenter, for heap readings and in-place switching. */
	segmenter(): ImageSegmenter | undefined;
	/** The WebGL context the effect renders in (shared with MediaPipe). */
	context(): WebGL2RenderingContext | undefined;
	/** A stream of the output, for recording. */
	stream(): MediaStream;
	dispose(): Promise<void>;
}
