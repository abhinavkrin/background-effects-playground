/**
 * How the model's confidence masks map to "background".
 * - `person`: one mask, the probability that the pixel is the person.
 * - `background-first`: several masks, the first is the probability that the pixel is background.
 */
export type MaskLayout = 'person' | 'background-first';

export interface ModelEntry {
	/** Stable id, used in URLs, verdicts and strategy references. */
	id: string;
	label: string;
	/** File name under public/models. */
	file: string;
	bytes: number;
	/** SHA-256 of the file, checked after every simulated download. */
	sha256: string;
	input: { width: number; height: number };
	maskLayout: MaskLayout;
	/** Class labels from the model's labels.txt, background first for multiclass models. */
	labels: readonly string[];
	precision: 'float16' | 'float32';
	/** Where the file came from, so it can be fetched again. */
	origin: string;
	notes: string;
}
