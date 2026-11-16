import { lab } from '../lab/lab';
import { useStore } from '../lib/store';

/** The effect every pane applies: blur with a radius, or none. */
export const BackgroundPanel = () => {
	const background = useStore(lab.background);
	const radius = background.mode === 'blur' ? background.radius : 10;
	return (
		<section className='panel'>
			<h2>Background</h2>
			<div className='segmented' role='radiogroup' aria-label='Background mode'>
				<button type='button' className={background.mode === 'blur' ? 'on' : ''} onClick={() => lab.setBackground({ mode: 'blur', radius })}>
					Blur
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
			<div className='muted'>Debug views (masks, overlay) are per pane, on editable-pipeline panes.</div>
		</section>
	);
};
