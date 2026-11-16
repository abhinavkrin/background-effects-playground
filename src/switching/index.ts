import { alwaysMulticlassPolicy } from './policies/alwaysMulticlass';
import { alwaysSmallPolicy } from './policies/alwaysSmall';
import { manualPolicy } from './policies/manual';
import { gatedPolicy } from './policies/gated';
import type { SwitchingPolicy } from './types';

export type { SwitchingPolicy } from './types';

/** Every switching policy the lab offers. Add one by writing a file in policies/ and listing it here. */
export const POLICIES: readonly SwitchingPolicy[] = [gatedPolicy, manualPolicy, alwaysSmallPolicy, alwaysMulticlassPolicy];

export const policyById = (id: string): SwitchingPolicy => {
	const policy = POLICIES.find((entry) => entry.id === id);
	if (!policy) {
		throw new Error(`unknown policy ${id}`);
	}
	return policy;
};
