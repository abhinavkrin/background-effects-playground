const WIDTH = 32;
const HEIGHT = 18;

const thumbnail = () => {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) {
		throw new Error('2D canvas is not available');
	}
	return context;
};

const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
	let sum = 0;
	for (let i = 0; i < a.length; i += 4) {
		sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
	}
	return sum / ((a.length / 4) * 3);
};

/**
 * Spots output frames that went out without the effect (a raw camera frame), by comparing a 32x18 thumbnail of the
 * output with one of the input. An effect frame differs from its input by a steady amount (the baseline); a raw frame
 * differs by almost nothing. Reading thumbnails back costs a GPU sync, so it only runs while armed.
 */
export class FlashDetector {
	private readonly input = thumbnail();

	private readonly output = thumbnail();

	private inputPixels: Uint8ClampedArray | null = null;

	private baseline: number | null = null;

	armedUntil = 0;

	flashes: number[] = [];

	get armed(): boolean {
		return performance.now() < this.armedUntil;
	}

	/** Watches for `ms`; the baseline is measured from the frames before the event the caller is about to cause. */
	arm(ms: number): void {
		this.armedUntil = performance.now() + ms;
	}

	sampleInput(frame: VideoFrame): void {
		this.input.drawImage(frame, 0, 0, WIDTH, HEIGHT);
		this.inputPixels = this.input.getImageData(0, 0, WIDTH, HEIGHT).data;
	}

	/** Returns true when this output frame looks like the raw input. */
	sampleOutput(source: CanvasImageSource): boolean {
		if (!this.inputPixels) {
			return false;
		}
		this.output.drawImage(source, 0, 0, WIDTH, HEIGHT);
		const diff = difference(this.output.getImageData(0, 0, WIDTH, HEIGHT).data, this.inputPixels);
		const baseline = this.baseline;
		// Only a clearly visible effect gives a usable baseline (a blur of a flat wall barely changes it).
		const raw = baseline !== null && baseline > 3 && diff < baseline * 0.3;
		if (raw) {
			this.flashes.push(performance.now());
		} else {
			this.baseline = baseline === null ? diff : baseline * 0.9 + diff * 0.1;
		}
		return raw;
	}

	flashesBetween(from: number, to: number): number {
		return this.flashes.filter((at) => at >= from && at <= to).length;
	}
}
