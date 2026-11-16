import { definePolicy } from '../types';

/** The small model, always. */
export const alwaysSmallPolicy = definePolicy<{ name: 'SMALL' }>({
	id: 'always-small',
	label: 'Always small',
	description: 'Landscape on every device, no download, no switching.',
	params: [],
	defaults: {},
	start: (ctx) => ({ state: { name: 'SMALL' }, model: ctx.small }),
	step: (state) => ({ state }),
});
