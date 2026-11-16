import { useEffect, useState } from 'react';
import { lab } from '../lab/lab';
import { BackgroundPanel } from './BackgroundPanel';
import { ComparePage } from './ComparePage';
import { SourcePanel } from './SourcePanel';
import { SwitchingPage } from './SwitchingPage';

type Tab = 'compare' | 'switching';

const supported = () => {
	const missing: string[] = [];
	if (!document.createElement('canvas').getContext('webgl2')) missing.push('WebGL2');
	if (typeof VideoFrame === 'undefined') missing.push('VideoFrame');
	if (typeof OffscreenCanvas === 'undefined') missing.push('OffscreenCanvas');
	if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) missing.push('requestVideoFrameCallback');
	return missing;
};

export const App = () => {
	const [tab, setTab] = useState<Tab>(() => (location.hash === '#switching' ? 'switching' : 'compare'));
	const missing = supported();

	useEffect(() => {
		location.hash = tab;
	}, [tab]);

	// A dropped video becomes the source.
	useEffect(() => {
		const over = (event: DragEvent) => event.preventDefault();
		const drop = (event: DragEvent) => {
			event.preventDefault();
			const file = event.dataTransfer?.files[0];
			if (file?.type.startsWith('video/')) {
				void lab.source.useFile(file);
			}
		};
		window.addEventListener('dragover', over);
		window.addEventListener('drop', drop);
		return () => {
			window.removeEventListener('dragover', over);
			window.removeEventListener('drop', drop);
		};
	}, []);

	return (
		<div className='app'>
			<header>
				<h1>Background Effects Playground</h1>
				<nav>
					<button type='button' className={tab === 'compare' ? 'on' : ''} onClick={() => setTab('compare')}>
						Compare
					</button>
					<button type='button' className={tab === 'switching' ? 'on' : ''} onClick={() => setTab('switching')}>
						Model switching
					</button>
				</nav>
				{missing.length > 0 && <span className='bad'>Missing: {missing.join(', ')}. Use a recent Chromium.</span>}
			</header>
			<aside>
				<SourcePanel />
				<BackgroundPanel />
			</aside>
			<main>
				<div className={tab === 'compare' ? '' : 'hidden'}>
					<ComparePage active={tab === 'compare'} />
				</div>
				<div className={tab === 'switching' ? '' : 'hidden'}>
					<SwitchingPage active={tab === 'switching'} />
				</div>
			</main>
		</div>
	);
};
