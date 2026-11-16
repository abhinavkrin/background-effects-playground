import { definePolicy } from '../types';

type State = { name: 'DOWNLOADING' } | { name: 'SWAPPING' } | { name: 'MULTICLASS' } | { name: 'FAILED'; reason: string };

/** Multiclass on every device: from the cache if it is there, otherwise downloaded at once and swapped in, unprobed. */
export const alwaysMulticlassPolicy = definePolicy<State>({
	id: 'always-multiclass',
	label: 'Always multiclass',
	description: 'Downloads the large model straight away and swaps to it with no gate, probe or probation. The upper bound on quality and the lower bound on safety.',
	params: [],
	defaults: {},
	start: (ctx) =>
		ctx.cached(ctx.large)
			? { state: { name: 'MULTICLASS' }, model: ctx.large, note: 'large model cached: start on it' }
			: { state: { name: 'DOWNLOADING' }, model: ctx.small, actions: [{ type: 'download', model: ctx.large }] },
	step: (state, ctx) => {
		for (const event of ctx.events) {
			if (event.type === 'download') {
				return event.ok
					? { state: { name: 'SWAPPING' }, actions: [{ type: 'swap', model: ctx.large }] }
					: { state: { name: 'FAILED', reason: event.error ?? 'download failed' }, note: `download failed: ${event.error}` };
			}
			if (event.type === 'swap') {
				return event.ok
					? { state: { name: 'MULTICLASS' } }
					: { state: { name: 'FAILED', reason: event.error ?? 'swap failed' }, actions: [{ type: 'recover', model: ctx.small }], note: `swap failed: ${event.error}` };
			}
		}
		return { state };
	},
});
