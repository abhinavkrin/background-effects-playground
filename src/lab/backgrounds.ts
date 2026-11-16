/** A background drawn on a canvas. */
const draw = (paint: (context: CanvasRenderingContext2D, width: number, height: number) => void): Promise<string> => {
	const canvas = document.createElement('canvas');
	canvas.width = 1280;
	canvas.height = 720;
	const context = canvas.getContext('2d');
	if (!context) {
		return Promise.reject(new Error('2D canvas is not available'));
	}
	paint(context, canvas.width, canvas.height);
	return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('toBlob failed'))), 'image/png'));
};

// High contrast lines: any error at the edge of the mask shows as a broken or bent stripe.
const stripes = (context: CanvasRenderingContext2D, width: number, height: number) => {
	context.fillStyle = '#f2f2f2';
	context.fillRect(0, 0, width, height);
	context.fillStyle = '#1a1a1a';
	for (let x = 0; x < width; x += 32) {
		context.fillRect(x, 0, 16, height);
	}
};

// A colour no skin or clothing has: background leaking through the person shows at once.
const flatGreen = (context: CanvasRenderingContext2D, width: number, height: number) => {
	context.fillStyle = '#00b140';
	context.fillRect(0, 0, width, height);
};

const photo = (file: string, label: string) => ({ label, url: new URL(`backgrounds/${file}`, document.baseURI).href });

/** CC0 photos from Wikimedia Commons; credits in NOTICE. The first is the default background. */
export const SCENERY = [photo('mountain-lake.jpg', 'Mountain lake'), photo('moraine-lake.jpg', 'Moraine Lake'), photo('forest-lake.jpg', 'Forest lake in autumn')];

let patterns: Promise<Array<{ label: string; url: string }>> | undefined;

/** Test patterns that make mask errors easy to see, drawn on first use. */
export const testPatterns = () =>
	(patterns ??= Promise.all([
		draw(stripes).then((url) => ({ label: 'Stripes (shows edge errors)', url })),
		draw(flatGreen).then((url) => ({ label: 'Flat green (shows leakage)', url })),
	]));
