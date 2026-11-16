import { conditions } from '../sim/conditions';
import type { Source } from './source';

/** Rate at which a paused video is sent again, so effects settle and parameter changes show. */
const REPEAT_FPS = 30;

/**
 * Drives the panes: one frame per source frame (webcam, playing video) or a steady repeat (paused video).
 *
 * `onInput` counts the frames the source produced, including the ones a busy main thread could not deliver: the
 * denominator of the processed/input ratio. For video it comes from presentedFrames, which keeps counting while the
 * main thread is blocked; for a repeat it comes from elapsed time.
 */
export class FrameClock {
	private generation = 0;

	private lastPresented = -1;

	/** Phase of the repeat timer: period boundaries since `phaseStart`, so jitter is not counted as lost frames. */
	private phaseStart = 0;

	private periods = 0;

	private periodFps = REPEAT_FPS;

	private inputCredit = 0;

	private lastMediaTime = -1;

	private lastCallbackAt = 0;

	private live = false;

	private watchdog: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly source: Source,
		private readonly onInput: (frames: number) => void,
		private readonly onFrame: (frame: VideoFrame) => void,
	) {}

	start(): void {
		// A pause, play or source change switches between video callbacks and the repeat timer.
		this.watchdog ??= setInterval(() => {
			if (this.source.isLive() !== this.live) {
				this.start();
			}
		}, 200);
		const generation = ++this.generation;
		this.live = this.source.isLive();
		this.lastPresented = -1;
		this.phaseStart = performance.now();
		this.periods = 0;
		this.inputCredit = 0;
		this.schedule(generation);
	}

	stop(): void {
		this.generation++;
		clearInterval(this.watchdog);
		this.watchdog = undefined;
	}

	private schedule(generation: number): void {
		if (generation !== this.generation) {
			return;
		}
		if (this.source.isLive()) {
			this.source.video.requestVideoFrameCallback((now, metadata) => this.onVideoFrame(generation, now, metadata));
			return;
		}
		const fps = this.cap() || REPEAT_FPS;
		if (fps !== this.periodFps) {
			this.periodFps = fps;
			this.phaseStart = performance.now();
			this.periods = 0;
		}
		setTimeout(() => this.onTimer(generation), Math.max(0, this.phaseStart + ((this.periods + 1) * 1000) / fps - performance.now()));
	}

	private onVideoFrame(generation: number, now: number, metadata: VideoFrameCallbackMetadata): void {
		if (generation !== this.generation) {
			return;
		}
		const presented = metadata.presentedFrames;
		const produced = this.lastPresented < 0 ? 1 : Math.max(0, presented - this.lastPresented);
		this.lastPresented = presented;
		if (this.lastMediaTime >= 0 && metadata.mediaTime > this.lastMediaTime && produced > 0) {
			this.source.setFrameRate(produced / (metadata.mediaTime - this.lastMediaTime));
		}
		this.lastMediaTime = metadata.mediaTime;
		const cap = this.cap();
		if (cap) {
			const elapsed = this.lastCallbackAt ? now - this.lastCallbackAt : 1000 / cap;
			this.inputCredit += Math.min(produced, (elapsed * cap) / 1000);
		} else {
			this.inputCredit += produced;
		}
		this.lastCallbackAt = now;
		this.deliver();
		this.schedule(generation);
	}

	private onTimer(generation: number): void {
		if (generation !== this.generation) {
			return;
		}
		// Every period boundary passed is one frame the "camera" produced, delivered or not.
		const periods = Math.floor(((performance.now() - this.phaseStart) * this.periodFps) / 1000);
		this.inputCredit += Math.max(0, periods - this.periods);
		this.periods = Math.max(this.periods, periods);
		this.deliver();
		this.schedule(generation);
	}

	/** Reports the frames produced and hands one on, if at least one whole frame was produced. */
	private deliver(): void {
		if (this.inputCredit < 1) {
			return;
		}
		const whole = Math.floor(this.inputCredit);
		this.inputCredit -= whole;
		this.onInput(whole);
		const frame = this.source.frame(Math.round(performance.now() * 1000));
		if (!frame) {
			return;
		}
		try {
			this.onFrame(frame);
		} finally {
			frame.close();
		}
	}

	private cap(): number {
		return conditions.get().inputFpsCap;
	}
}
