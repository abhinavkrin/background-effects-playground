import { useEffect, useRef, useState, type ReactNode } from 'react';
import { lab } from '../lab/lab';
import type { Pane } from '../lab/pane';
import { jsHeapBytes, wasmHeapBytes } from '../lib/mediapipe';
import { useStore, useTicker } from '../lib/store';
import { ENGINE_LABELS } from '../engines/types';
import { modelById } from '../models';
import { mb, ms, saveBlob, stamp } from './files';

interface PaneSurfaceProps {
	pane: Pane;
	/** Whether this pane gets frames (its tab is visible). */
	active: boolean;
	/** Strategy label for the overlay. */
	strategyLabel: string;
	header?: ReactNode;
	footer?: ReactNode;
}

/** Shows a pane's output with its metrics on top, and records it. */
export const PaneSurface = ({ pane, active, strategyLabel, header, footer }: PaneSurfaceProps) => {
	const host = useRef<HTMLDivElement>(null);
	const state = useStore(pane.state);
	useTicker(500);
	const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

	useEffect(() => lab.attach(pane), [pane]);
	useEffect(() => lab.setActive(pane, active), [pane, active]);

	// The engine creates its own element; put the current one in the host.
	const element = pane.engine?.element;
	useEffect(() => {
		const container = host.current;
		if (!container) {
			return;
		}
		container.replaceChildren(...(element ? [element] : []));
		if (element instanceof HTMLVideoElement) {
			void element.play().catch(() => undefined);
		}
	}, [element, state.status]);

	const metrics = pane.metrics.snapshot();
	const segmenter = pane.engine?.segmenter();
	const model = state.modelId ? modelById(state.modelId) : undefined;

	const record = () => {
		if (recorder) {
			recorder.stop();
			return;
		}
		const engine = pane.engine;
		if (!engine) {
			return;
		}
		const chunks: Blob[] = [];
		const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
		const next = new MediaRecorder(engine.stream(), mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
		next.ondataavailable = (event) => chunks.push(event.data);
		next.onstop = () => {
			saveBlob(new Blob(chunks, { type: 'video/webm' }), `pane-${pane.id}-${state.engine}-${state.modelId}-${stamp()}.webm`);
			setRecorder(null);
		};
		next.start(500);
		setRecorder(next);
	};

	return (
		<div className='pane' data-pane={pane.id}>
			{header}
			<div className='pane-media'>
				<div ref={host} className='pane-host' />
				{state.status !== 'ready' && state.status !== 'switching' && <div className='pane-status'>{state.status === 'error' ? `Error: ${state.error}` : state.status}</div>}
				<div className='overlay'>
					<div>
						<b>{state.engine ? ENGINE_LABELS[state.engine] : '-'}</b> · {model?.label ?? '-'} · {strategyLabel}
					</div>
					<div>
						fps {metrics.processedFps.toFixed(1)} / {metrics.inputFps.toFixed(1)} in · ratio <b className={metrics.ratio !== null && metrics.ratio < 0.8 ? 'bad' : ''}>{metrics.ratio?.toFixed(2) ?? '-'}</b>
					</div>
					<div>
						frame p50 {ms(metrics.frameP50)} · p90 {ms(metrics.frameP90)} · seg {ms(metrics.segmentationMs)}
					</div>
					{metrics.gpuProbeP50 !== undefined && (
						<div>
							gpu readback p50 {ms(metrics.gpuProbeP50)} · p90 {ms(metrics.gpuProbeP90)}
						</div>
					)}
					<div>
						wasm {mb(wasmHeapBytes(segmenter))} · js {mb(jsHeapBytes())}
						{metrics.rawFrames > 0 && ` · raw frames ${metrics.rawFrames}`}
						{metrics.errors > 0 && <span className='bad'> · errors {metrics.errors}</span>}
					</div>
					{metrics.lastError && <div className='bad overlay-error'>{metrics.lastError.slice(0, 120)}</div>}
				</div>
			</div>
			<div className='pane-tools'>
				<button type='button' onClick={record} disabled={!pane.engine}>
					{recorder ? 'Stop recording' : 'Record'}
				</button>
				{footer}
			</div>
		</div>
	);
};
