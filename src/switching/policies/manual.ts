import { definePolicy } from '../types';

/** Starts on the small model and never switches by itself; use the switch buttons. */
export const manualPolicy = definePolicy<{ name: 'MANUAL' }>({
	id: 'manual',
	label: 'Manual',
	description: 'Starts on the small model and does nothing on its own. Switch with the buttons to compare methods.',
	params: [],
	defaults: {},
	start: (ctx) => ({ state: { name: 'MANUAL' }, model: ctx.small }),
	step: (state) => ({ state }),
});
