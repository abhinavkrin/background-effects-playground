/** Per-second counts, the unit the switching policies reason in. */
interface Bucket {
	second: number;
	input: number;
	processed: number;
}

const percentile = (values: number[], p: number): number | undefined => {
	if (!values.length) {
		return undefined;
	}
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

export interface MetricsSnapshot {
	inputFps: number;
	processedFps: number;
	/** processed / input over the last 2 s. */
	ratio: number | null;
	segmentationMs?: number;
	frameP50?: number;
	frameP90?: number;
	gpuProbeP50?: number;
	gpuProbeP90?: number;
	rawFrames: number;
	errors: number;
	lastError?: string;
}

/** Throughput and timing of one pane, fed by the clock (input) and the engine (output). */
export class PaneMetrics {
	private buckets: Bucket[] = [];

	private frameTimes: number[] = [];

	private segmentationTimes: number[] = [];

	private probeTimes: number[] = [];

	/** performance.now() of recent output frames, for gap analysis around switches. */
	readonly outputs: number[] = [];

	rawFrames = 0;

	errors = 0;

	lastError: string | undefined;

	recordInput(frames: number, at = performance.now()): void {
		this.bucket(at).input += frames;
	}

	recordFrame(report: { at: number; frameMs: number; segmentationMs: number; gpuProbeMs?: number; raw?: boolean; error?: string }): void {
		this.bucket(report.at).processed += 1;
		this.push(this.frameTimes, report.frameMs, 120);
		this.push(this.segmentationTimes, report.segmentationMs, 120);
		if (report.gpuProbeMs !== undefined) {
			this.push(this.probeTimes, report.gpuProbeMs, 120);
		}
		this.push(this.outputs, report.at, 4000);
		if (report.raw) {
			this.rawFrames++;
		}
		if (report.error) {
			this.errors++;
			this.lastError = report.error;
		}
	}

	/** processed / input over the last `seconds` whole seconds; null until there is input. */
	ratio(seconds: number, now = performance.now()): number | null {
		const current = Math.floor(now / 1000);
		let input = 0;
		let processed = 0;
		for (const bucket of this.buckets) {
			if (bucket.second < current && bucket.second >= current - seconds) {
				input += bucket.input;
				processed += bucket.processed;
			}
		}
		return input > 0 ? Math.min(1.5, processed / input) : null;
	}

	fps(seconds: number, now = performance.now()): { input: number; processed: number } {
		const current = Math.floor(now / 1000);
		let input = 0;
		let processed = 0;
		for (const bucket of this.buckets) {
			if (bucket.second < current && bucket.second >= current - seconds) {
				input += bucket.input;
				processed += bucket.processed;
			}
		}
		return { input: input / seconds, processed: processed / seconds };
	}

	/** Longest interval between output frames in [from, to], and the number of frames in it. */
	gap(from: number, to: number): { maxGapMs: number; frames: number } {
		let previous: number | undefined;
		let maxGapMs = 0;
		let frames = 0;
		for (const at of this.outputs) {
			if (at < from - 1000) {
				continue;
			}
			if (at > to) {
				break;
			}
			if (previous !== undefined && at >= from) {
				maxGapMs = Math.max(maxGapMs, at - previous);
			}
			if (at >= from) {
				frames++;
			}
			previous = at;
		}
		return { maxGapMs, frames };
	}

	snapshot(): MetricsSnapshot {
		const { input, processed } = this.fps(2);
		return {
			inputFps: input,
			processedFps: processed,
			ratio: this.ratio(2),
			segmentationMs: percentile(this.segmentationTimes, 0.5),
			frameP50: percentile(this.frameTimes, 0.5),
			frameP90: percentile(this.frameTimes, 0.9),
			gpuProbeP50: percentile(this.probeTimes, 0.5),
			gpuProbeP90: percentile(this.probeTimes, 0.9),
			rawFrames: this.rawFrames,
			errors: this.errors,
			lastError: this.lastError,
		};
	}

	/** Slowest frame (frame time) among the last frames, for switch reports. */
	slowestRecent(count: number): number {
		return Math.max(0, ...this.frameTimes.slice(-count));
	}

	private bucket(at: number): Bucket {
		const second = Math.floor(at / 1000);
		let bucket = this.buckets[this.buckets.length - 1];
		if (!bucket || bucket.second !== second) {
			bucket = { second, input: 0, processed: 0 };
			this.buckets.push(bucket);
			if (this.buckets.length > 600) {
				this.buckets.shift();
			}
		}
		return bucket;
	}

	private push(list: number[], value: number, max: number): void {
		list.push(value);
		if (list.length > max) {
			list.shift();
		}
	}
}
