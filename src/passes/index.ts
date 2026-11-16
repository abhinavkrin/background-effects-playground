import { adaptiveTemporalPass } from './adaptiveTemporal';
import { bilateralPass } from './bilateral';
import { boxBlurPass } from './boxBlur';
import { normalizePass } from './normalize';
import { temporalPass } from './temporal';
import type { PassDefinition } from './types';

export type { PassConfig, PassContext, PassDefinition, PassInstance, PassStage } from './types';

/** Every pass a strategy can list. Add a pass by writing a PassDefinition next to these and adding it here. */
export const PASSES: readonly PassDefinition[] = [normalizePass, boxBlurPass, temporalPass, adaptiveTemporalPass, bilateralPass];

export const passById = (id: string): PassDefinition => {
	const pass = PASSES.find((entry) => entry.id === id);
	if (!pass) {
		throw new Error(`unknown pass ${id}`);
	}
	return pass;
};
