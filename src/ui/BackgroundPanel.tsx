import { useEffect } from 'react';
import { testPatterns } from '../lab/backgrounds';
import { lab } from '../lab/lab';
import { useStore } from '../lib/store';

/** The effect every pane applies: blur with a radius, an image, or none. */
export const BackgroundPanel = () => {
	const background = useStore(lab.background);
	const images = useStore(lab.backgroundImages);
	const radius = background.mode === 'blur' ? background.radius : 10;

	useEffect(() => {
		void testPatterns().then((patterns) => {
			const images = lab.backgroundImages.get();
			if (!images.includes(patterns[0])) {
				lab.backgroundImages.set([...images, ...patterns]);
			}
		});
	}, []);

	return (
		<section className='panel'>
			<h2>Background</h2>
			<div className='segmented' role='radiogroup' aria-label='Background mode'>
				<button type='button' className={background.mode === 'blur' ? 'on' : ''} onClick={() => lab.setBackground({ mode: 'blur', radius })}>
					Blur
				</button>
				<button type='button' className={background.mode === 'image' ? 'on' : ''} onClick={() => lab.setBackground({ mode: 'image', url: images[0].url })}>
					Image
				</button>
				<button type='button' className={background.mode === 'none' ? 'on' : ''} onClick={() => lab.setBackground({ mode: 'none' })}>
					None
				</button>
			</div>
			{background.mode === 'blur' && (
				<label className='param'>
					<span>Blur radius: {background.radius}</span>
					<input type='range' min={1} max={64} value={background.radius} onChange={(event) => lab.setBackground({ mode: 'blur', radius: Number(event.target.value) })} />
				</label>
			)}
			{background.mode === 'image' && (
				<div className='thumbs'>
					{images.map((image) => (
						<button key={image.url} type='button' className={background.url === image.url ? 'on' : ''} title={image.label} onClick={() => lab.setBackground({ mode: 'image', url: image.url })}>
							<img src={image.url} alt={image.label} />
						</button>
					))}
				</div>
			)}
			<label className='file'>
				Use your own image
				<input
					type='file'
					accept='image/*'
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) {
							const url = URL.createObjectURL(file);
							lab.backgroundImages.set([...lab.backgroundImages.get(), { label: file.name, url }]);
							lab.setBackground({ mode: 'image', url });
						}
					}}
				/>
			</label>
			<div className='muted'>Debug views (masks, overlay) are per pane, on custom-pipeline panes.</div>
		</section>
	);
};
