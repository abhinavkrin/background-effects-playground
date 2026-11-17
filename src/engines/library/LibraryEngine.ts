import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { BackgroundProcessor, type BackgroundOptions, type BackgroundProcessorWrapper, type SwitchBackgroundProcessorOptions } from '@livekit/track-processors';
import { LocalVideoTrack } from 'livekit-client';
import { WASM_BASE, createSegmenter, wasmHeapBytes } from '../../lib/mediapipe';
import { modelUrl, type ModelEntry } from '../../models';
import type { BackgroundSetting } from '../../passes/background';
import { GpuLoad, forcedReadback } from '../../sim/gpuLoad';
import { busyWait, conditions } from '../../sim/conditions';
import type { Strategy } from '../../strategies';
import type { Engine, EngineInit, FrameReport, LibraryOptions, SwitchMethod, SwitchReport } from '../types';

type FrameProcessingStats = Parameters<NonNullable<BackgroundOptions['onFrameProcessed']>>[0];

let instances = 0;

/** How long dispose waits for the library to stop its processor before stopping the track regardless. */
const STOP_PROCESSOR_TIMEOUT_MS = 1000;

const switchOptions = (background: BackgroundSetting): SwitchBackgroundProcessorOptions => {
	switch (background.mode) {
		case 'blur':
			return { mode: 'background-blur', blurRadius: background.radius };
		case 'image':
			return { mode: 'virtual-background', imagePath: background.url };
		default:
			return { mode: 'disabled' };
	}
};

/**
 * @livekit/track-processors itself, driven the way an app drives it: a LocalVideoTrack (never published to a room),
 * `setProcessor(BackgroundProcessor(...))`, and `switchTo(...)` for effect changes, with `options` passed through.
 *
 * Input: each frame is drawn into a canvas whose `captureStream(0)` track stands in for the camera, and
 * `requestFrame()` emits it, so every pane gets the same frames. Output: the processed track, attached to a <video>.
 */
export class LibraryEngine implements Engine {
	readonly kind = 'library' as const;


	readonly supportsViews = false;

	readonly element: HTMLVideoElement;

	onFrame: (report: FrameReport) => void = () => undefined;

	private readonly relay: HTMLCanvasElement;

	private readonly relayContext: CanvasRenderingContext2D;

	private relayTrack: CanvasCaptureMediaStreamTrack | undefined;

	private track: LocalVideoTrack | undefined;

	private processor: BackgroundProcessorWrapper | undefined;

	private model!: ModelEntry;

	private background: BackgroundSetting = { mode: 'none' };

	private gpuLoad: { gl: WebGL2RenderingContext; load: GpuLoad } | undefined;

	private readonly name = `playground-library-${++instances}`;

	private disposed = false;

	/** A processor is being set up; it applies the latest background when it is ready. */
	private starting = false;

	constructor(private readonly options: LibraryOptions) {
		this.element = document.createElement('video');
		this.element.muted = true;
		this.element.playsInline = true;
		this.element.autoplay = true;
		this.relay = document.createElement('canvas');
		const relayContext = this.relay.getContext('2d');
		if (!relayContext) {
			throw new Error('2D canvas is not available');
		}
		this.relayContext = relayContext;
	}

	get modelId(): string {
		return this.model.id;
	}

	async init(init: EngineInit): Promise<void> {
		this.model = init.model;
		this.background = init.background;
		this.relay.width = init.width;
		this.relay.height = init.height;
		const stream = this.relay.captureStream(0);
		this.relayTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
		// A first frame, so the track reports its size when the processor sets up.
		this.relayContext.fillRect(0, 0, init.width, init.height);
		this.relayTrack.requestFrame();
		this.track = new LocalVideoTrack(this.relayTrack, undefined, true);
		this.track.attach(this.element);
		if (init.background.mode !== 'none') {
			await this.startProcessor(init.model, init.bytes);
		}
	}

	push(frame: VideoFrame): void {
		const relayTrack = this.relayTrack;
		if (!relayTrack) {
			return;
		}
		const width = frame.displayWidth;
		const height = frame.displayHeight;
		if (this.relay.width !== width || this.relay.height !== height) {
			this.relay.width = width;
			this.relay.height = height;
		}
		this.relayContext.drawImage(frame, 0, 0, width, height);
		relayTrack.requestFrame();
		if (!this.processor) {
			// No effect: the processor is stopped and the camera goes out as is.
			this.onFrame({ at: performance.now(), frameMs: 0, segmentationMs: 0, raw: true });
		}
	}

	async setBackground(background: BackgroundSetting): Promise<void> {
		const previous = this.background;
		this.background = background;
		const track = this.track;
		if (!track || this.starting) {
			return;
		}
		if (background.mode === 'none') {
			if (track.getProcessor()) {
				await track.stopProcessor();
				this.processor = undefined;
			}
			return;
		}
		if (this.processor && previous.mode !== 'none') {
			await this.processor.switchTo(switchOptions(background));
			return;
		}
		await this.startProcessor(this.model);
	}

	async setStrategy(_strategy: Strategy): Promise<void> {
		// The library has no strategies; `options` are its only settings.
	}

	setView(): void {
		// Only the effect: the library keeps its masks to itself.
	}

	async switchModel(model: ModelEntry, bytes: Uint8Array, method: SwitchMethod): Promise<SwitchReport> {
		const startedAt = performance.now();
		const report: SwitchReport = { method, from: this.model.id, to: model.id, startedAt, callMs: 0, ok: false, heapBefore: wasmHeapBytes(this.segmenter()) };
		try {
			const transformer = this.processor?.transformer;
			// With no effect running, the next processor starts on the new model.
			if (transformer && method === 'in-place') {
				const segmenter = transformer.imageSegmenter;
				if (!segmenter) {
					throw new Error('no segmenter');
				}
				await segmenter.setOptions({ baseOptions: { modelAssetBuffer: bytes, delegate: 'GPU' } });
			} else if (transformer && method === 'second-segmenter') {
				const canvas = transformer.canvas;
				if (!canvas) {
					throw new Error('no canvas');
				}
				const next = await createSegmenter(canvas, { bytes }, this.segmenterOutput());
				const old = transformer.imageSegmenter;
				transformer.imageSegmenter = next;
				old?.close();
			} else if (transformer) {
				await this.startProcessor(model, bytes);
			}
			this.model = model;
			report.ok = true;
		} catch (e) {
			report.error = e instanceof Error ? e.message : String(e);
		}
		report.callMs = performance.now() - startedAt;
		report.heapAfter = wasmHeapBytes(this.segmenter());
		return report;
	}

	segmenter(): ImageSegmenter | undefined {
		return this.processor?.transformer.imageSegmenter;
	}

	context(): WebGL2RenderingContext | undefined {
		const canvas = this.processor?.transformer.canvas;
		return (canvas?.getContext('webgl2') as WebGL2RenderingContext | null) ?? undefined;
	}

	stream(): MediaStream {
		const processed = this.processor?.processedTrack;
		return new MediaStream(processed ? [processed] : this.relayTrack ? [this.relayTrack] : []);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.track) {
			this.track.detach(this.element);
			// A processor that has never seen a camera frame (no source started) can leave stopProcessor pending
			// forever, which would block the pane from starting its next engine. Stopping the track ends it anyway.
			const stopped = await Promise.race([
				this.track.stopProcessor().then(
					() => true,
					() => true,
				),
				new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_PROCESSOR_TIMEOUT_MS)),
			]);
			if (!stopped) {
				console.warn(`${this.name}: stopProcessor did not finish in ${STOP_PROCESSOR_TIMEOUT_MS} ms; stopping the track instead`);
			}
			this.track.stop();
		}
		this.gpuLoad?.load.dispose();
		this.relayTrack?.stop();
		this.processor = undefined;
		this.track = undefined;
	}

	private segmenterOutput(): 'confidence' | 'category' {
		return this.options.segmentationMask;
	}

	/**
	 * Builds the processor for the current effect and sets it on the track. A processor being replaced keeps
	 * reporting frames until setProcessor stops it, since the viewer keeps seeing them.
	 */
	private async startProcessor(model: ModelEntry, bytes?: Uint8Array): Promise<void> {
		this.starting = true;
		try {
			await this.setUpProcessor(model, bytes);
		} finally {
			this.starting = false;
		}
	}

	private async setUpProcessor(model: ModelEntry, bytes?: Uint8Array): Promise<void> {
		const setting = this.background;
		const background = switchOptions(setting);
		const options = background.mode === 'disabled' ? ({ mode: 'background-blur', blurRadius: 10 } as const) : background;
		const processor = BackgroundProcessor(
			{
				...options,
				...this.options,
				assetPaths: { tasksVisionFileSet: WASM_BASE, modelAssetPath: modelUrl(model) },
				// Built from bytes when given: these override the model path in assetPaths.
				segmenterOptions: bytes ? { modelAssetPath: undefined, modelAssetBuffer: bytes, delegate: 'GPU' } : undefined,
				onFrameProcessed: (stats) => {
					if (!this.disposed) {
						this.onProcessed(stats);
					}
				},
			},
			this.name,
		);
		await this.track?.setProcessor(processor);
		if (this.disposed) {
			await this.track?.stopProcessor();
			return;
		}
		this.processor = processor;
		// The background changed while the processor was being set up.
		if (this.background === setting) {
			return;
		}
		if (this.background.mode === 'none') {
			await this.track?.stopProcessor();
			this.processor = undefined;
		} else {
			await processor.switchTo(switchOptions(this.background));
		}
	}

	private onProcessed(stats: FrameProcessingStats): void {
		const start = performance.now();
		const { gpuExtraPasses, gpuIterations, gpuProbe, cpuBusyMs } = conditions.get();
		const gl = this.context();
		if (gl && gpuExtraPasses > 0) {
			if (this.gpuLoad?.gl !== gl) {
				this.gpuLoad = { gl, load: new GpuLoad(gl) };
			}
			this.gpuLoad.load.run(gpuExtraPasses, gpuIterations);
		}
		const gpuProbeMs = gl && gpuProbe ? forcedReadback(gl) : undefined;
		busyWait(cpuBusyMs);
		const at = performance.now();
		this.onFrame({ at, frameMs: stats.processingTimeMs + (at - start), segmentationMs: stats.segmentationTimeMs, gpuProbeMs });
	}
}
