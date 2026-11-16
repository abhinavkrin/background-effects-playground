/** Saves a blob through a normal download; this is a local app, so the browser's downloads folder is fine. */
export const saveBlob = (blob: Blob, name: string): void => {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export const mb = (bytes: number | undefined): string => (bytes === undefined ? '-' : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export const ms = (value: number | undefined, digits = 1): string => (value === undefined ? '-' : `${value.toFixed(digits)} ms`);
