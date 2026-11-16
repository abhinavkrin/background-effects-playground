import { Store } from '../lib/store';

export type SourceKind = 'webcam' | 'file';

export type Resolution = '360p' | '720p' | '1080p';

export const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
	'360p': { width: 640, height: 360 },
	'720p': { width: 1280, height: 720 },
	'1080p': { width: 1920, height: 1080 },
};

export interface SourceState {
	kind: SourceKind | null;
	label: string;
	width: number;
	height: number;
	playing: boolean;
	duration: number;
	currentTime: number;
	/** The video's frame rate, as measured from presented frames; used for frame stepping. */
	frameRate: number;
	error?: string;
}

/**
 * The one input every pane processes: a webcam or a looping video file. Produces a VideoFrame on
 * demand, so the same frame can go to every engine.
 */
export class Source {
	readonly state = new Store<SourceState>({ kind: null, label: 'none', width: 0, height: 0, playing: false, duration: 0, currentTime: 0, frameRate: 30 });

	/** The <video> playing a webcam or file; the sidebar shows it, which keeps its frame callbacks running. */
	readonly video: HTMLVideoElement;

	private stream: MediaStream | null = null;

	private objectUrl: string | null = null;

	constructor() {
		this.video = document.createElement('video');
		this.video.muted = true;
		this.video.playsInline = true;
		this.video.loop = true;
		const sync = () => this.state.update({ playing: !this.video.paused, currentTime: this.video.currentTime, duration: Number.isFinite(this.video.duration) ? this.video.duration : 0 });
		for (const event of ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata', 'durationchange']) {
			this.video.addEventListener(event, sync);
		}
		this.video.addEventListener('resize', () => this.state.update({ width: this.video.videoWidth, height: this.video.videoHeight }));
	}

	async useWebcam(deviceId: string | undefined, resolution: Resolution): Promise<void> {
		this.release();
		const { width, height } = RESOLUTIONS[resolution];
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: width }, height: { ideal: height } },
				audio: false,
			});
			this.video.srcObject = this.stream;
			await this.video.play();
			const settings = this.stream.getVideoTracks()[0].getSettings();
			this.state.set({ ...this.state.get(), kind: 'webcam', label: this.stream.getVideoTracks()[0].label, width: settings.width ?? width, height: settings.height ?? height, error: undefined });
		} catch (e) {
			this.state.update({ kind: null, error: String(e) });
		}
	}

	async useFile(file: File): Promise<void> {
		this.release();
		this.objectUrl = URL.createObjectURL(file);
		this.video.src = this.objectUrl;
		try {
			await this.video.play();
			this.state.set({ ...this.state.get(), kind: 'file', label: file.name, width: this.video.videoWidth, height: this.video.videoHeight, error: undefined });
		} catch (e) {
			this.state.update({ kind: null, error: String(e) });
		}
	}

	/** True while a video is playing, when new frames arrive on their own. */
	isLive(): boolean {
		const { kind } = this.state.get();
		return (kind === 'webcam' || kind === 'file') && !this.video.paused && this.video.readyState >= 2;
	}

	/** The current picture as a VideoFrame, or null when there is none yet. */
	frame(timestampUs: number): VideoFrame | null {
		const { kind } = this.state.get();
		if ((kind === 'webcam' || kind === 'file') && this.video.readyState >= 2 && this.video.videoWidth > 0) {
			return new VideoFrame(this.video, { timestamp: timestampUs });
		}
		return null;
	}

	play(): void {
		void this.video.play();
	}

	pause(): void {
		this.video.pause();
	}

	/** Moves a paused video by whole frames. */
	step(frames: number): void {
		this.video.pause();
		const frameRate = this.state.get().frameRate || 30;
		this.seek(this.video.currentTime + frames / frameRate);
	}

	seek(time: number): void {
		const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
		this.video.currentTime = Math.min(Math.max(0, time), Math.max(0, duration - 0.001));
	}

	setFrameRate(frameRate: number): void {
		if (Math.abs(frameRate - this.state.get().frameRate) > 0.5) {
			this.state.update({ frameRate });
		}
	}

	private release(): void {
		this.video.pause();
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.video.srcObject = null;
		this.video.removeAttribute('src');
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}
}
