/** A value a pass, strategy or policy can be tuned with from the UI. */
export type ParamValue = number | boolean | string;

export type ParamSpec =
	| { key: string; label: string; kind: 'number'; min: number; max: number; step: number; help?: string }
	| { key: string; label: string; kind: 'boolean'; help?: string }
	| { key: string; label: string; kind: 'select'; options: readonly string[]; help?: string };

export type Params = Record<string, ParamValue>;

export const num = (params: Params, key: string, fallback: number): number => {
	const value = params[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

export const bool = (params: Params, key: string, fallback: boolean): boolean => {
	const value = params[key];
	return typeof value === 'boolean' ? value : fallback;
};
