/** The device's last word on which model it can run, as an app would keep it in localStorage. */
export interface Verdict {
	v: 1;
	model: string;
	/** SHA-256 of the large model the verdict is about; a new model file means a new trial. */
	modelSha: string;
	renderer: string;
	reason: string;
	at: number;
	until: number;
}

export const VERDICT_KEY = 'background-effects-playground:segmentation-model';

export const readStoredVerdict = (): Verdict | null => {
	try {
		const raw = localStorage.getItem(VERDICT_KEY);
		const verdict = raw ? (JSON.parse(raw) as Verdict) : null;
		return verdict?.v === 1 ? verdict : null;
	} catch {
		return null;
	}
};

/** The stored verdict if it applies to this GPU and this model file and has not expired. */
export const readVerdict = (renderer: string, modelSha: string, now = Date.now()): Verdict | null => {
	const verdict = readStoredVerdict();
	if (!verdict || verdict.renderer !== renderer || verdict.modelSha !== modelSha || verdict.until < now) {
		return null;
	}
	return verdict;
};

export const writeVerdict = (verdict: Omit<Verdict, 'v' | 'at' | 'until'>, days: number): Verdict => {
	const at = Date.now();
	const stored: Verdict = { v: 1, ...verdict, at, until: at + days * 86_400_000 };
	try {
		localStorage.setItem(VERDICT_KEY, JSON.stringify(stored));
	} catch {
		// Private mode or storage blocked: the verdict lives for this page only.
	}
	return stored;
};

export const clearVerdict = (): void => {
	try {
		localStorage.removeItem(VERDICT_KEY);
	} catch {
		// nothing stored
	}
};
