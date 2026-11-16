import { Store } from '../lib/store';
import { SCENERY } from './backgrounds';
import type { BackgroundSetting } from '../passes/background';
import { FrameClock } from '../sources/clock';
import { Source } from '../sources/source';
import type { Pane } from './pane';

/** The source, the clock and the panes that receive frames: the one place frames flow through. */
export class Lab {
	readonly source = new Source();

	readonly background = new Store<BackgroundSetting>({ mode: 'image', url: SCENERY[0].url });

	/** The scenery photos, then the test patterns and uploads as they are added. */
	readonly backgroundImages = new Store<Array<{ label: string; url: string }>>(SCENERY);

	/** Panes of the visible tab: only these get frames, so hidden panes do not skew measurements. */
	private readonly active = new Set<Pane>();

	private readonly all = new Set<Pane>();

	readonly clock: FrameClock;

	constructor() {
		this.clock = new FrameClock(
			this.source,
			(frames) => this.active.forEach((pane) => pane.metrics.recordInput(frames)),
			(frame) => this.active.forEach((pane) => pane.push(frame)),
		);
		this.clock.start();
	}

	/** Tracks a pane for background changes; it gets frames only while active. */
	attach(pane: Pane): () => void {
		this.all.add(pane);
		return () => {
			this.active.delete(pane);
			this.all.delete(pane);
		};
	}

	setActive(pane: Pane, active: boolean): void {
		if (active) {
			this.active.add(pane);
		} else {
			this.active.delete(pane);
		}
	}

	setBackground(background: BackgroundSetting): void {
		this.background.set(background);
		this.all.forEach((pane) => void pane.setBackground(background));
	}

	panes(): Pane[] {
		return [...this.all];
	}
}

export const lab = new Lab();
