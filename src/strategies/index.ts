import { categoryMask } from './categoryMask';
import { adaptiveEdgeFloor, confidenceAdaptive, confidenceAdaptiveEdges, confidenceEdges, confidenceFixedEdges, confidenceOnly, confidenceOpacity } from './confidenceMask';
import type { Strategy } from './types';

export type { Strategy } from './types';

/** Every preset the editable pipeline offers. Add one next to these and list it here. */
export const STRATEGIES: readonly Strategy[] = [
	confidenceAdaptiveEdges,
	categoryMask,
	confidenceOnly,
	confidenceOpacity,
	confidenceAdaptive,
	confidenceEdges,
	confidenceFixedEdges,
	adaptiveEdgeFloor,
];

export const strategyById = (id: string): Strategy => {
	const strategy = STRATEGIES.find((entry) => entry.id === id);
	if (!strategy) {
		throw new Error(`unknown strategy ${id}`);
	}
	return strategy;
};

/** A deep copy the UI can edit without touching the preset. */
export const cloneStrategy = (strategy: Strategy): Strategy => JSON.parse(JSON.stringify(strategy)) as Strategy;
