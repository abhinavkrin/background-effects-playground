import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { BackgroundProcessor as StockProcessor, type BackgroundOptions, type BackgroundProcessorWrapper, type SwitchBackgroundProcessorOptions } from '@livekit/track-processors';
import { BackgroundProcessor as ProposedProcessor } from 'track-processors-proposed';
import { LocalVideoTrack } from 'livekit-client';
import { WASM_BASE, createSegmenter, wasmHeapBytes } from '../../lib/mediapipe';
import { modelUrl, type ModelEntry } from '../../models';
import type { BackgroundSetting } from '../../passes/background';
import { GpuLoad, forcedReadback } from '../../sim/gpuLoad';
import { busyWait, conditions } from '../../sim/conditions';
import type { Strategy } from '../../strategies';
import type { Engine, EngineInit, FrameReport, LibraryBuild, LibraryOptions, SwitchMethod, SwitchReport } from '../types';

type FrameProcessingStats = Parameters<NonNullable<BackgroundOptions['onFrameProcessed']>>[0];

let instances = 0;

const switchOptions = (background: BackgroundSetting): SwitchBackgroundProcessorOptions =>
	background.mode === 'blur' ? { mode: 'background-blur', blurRadius: background.radius } : { mode: 'disabled' };

/**
 * @livekit/track-processors itself, driven the way an app drives it: a LocalVideoTrack (never published to a room),
 * `setProcessor(BackgroundProcessor(...))`, and `switchTo(...)` for effect changes. `stock` is upstream main;
 * `proposed` is main with the options under review upstream, set from `options`.
 *
 * Input: each frame is drawn into a canvas whose `captureStream(0)` track stands in for the camera, and
 * `requestFrame()` emits it, so every pane gets the same frames. Output: the processed track, attached to a <video>.
 */
export class LibraryEngine implements Engine {

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

	constructor(
		readonly kind: LibraryBuild,
		private readonly options: LibraryOptions,
	) {
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
		if (!track) {
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
			if (!this.track || !transformer) {
				throw new Error('no processor running');
			}
			if (method === 'in-place') {
				const segmenter = transformer.imageSegmenter;
				if (!segmenter) {
					throw new Error('no segmenter');
				}
				await segmenter.setOptions({ baseOptions: { modelAssetBuffer: bytes, delegate: 'GPU' } });
			} else if (method === 'second-segmenter') {
				const canvas = transformer.canvas;
				if (!canvas) {
					throw new Error('no canvas');
				}
				const next = await createSegmenter(canvas, { bytes }, this.segmenterOutput());
				const old = transformer.imageSegmenter;
				transformer.imageSegmenter = next;
				old?.close();
			} else {
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
			await this.track.stopProcessor().catch(() => undefined);
			this.track.stop();
		}
		this.gpuLoad?.load.dispose();
		this.relayTrack?.stop();
		this.processor = undefined;
		this.track = undefined;
	}

	private segmenterOutput(): 'confidence' | 'category' {
		return this.kind === 'proposed' && this.options.segmentationMask === 'confidence' ? 'confidence' : 'category';
	}

	/**
	 * Builds the processor for the current effect and sets it on the track. A processor being replaced keeps
	 * reporting frames until setProcessor stops it, since the viewer keeps seeing them.
	 */
	private async startProcessor(model: ModelEntry, bytes?: Uint8Array): Promise<void> {
		const background = switchOptions(this.background);
		const options = background.mode === 'disabled' ? ({ mode: 'background-blur', blurRadius: 10 } as const) : background;
		// The proposed build takes the stock options plus its own, so it is called through the stock signature.
		const build = this.kind === 'proposed' ? (ProposedProcessor as unknown as typeof StockProcessor) : StockProcessor;
		const processor = build(
			{
				...options,
				...(this.kind === 'proposed' ? this.options : {}),
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
		this.processor = processor;
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
