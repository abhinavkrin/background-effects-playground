import { useEffect, useRef, useState } from 'react';
import { lab } from '../lab/lab';
import { useStore } from '../lib/store';
import { conditions } from '../sim/conditions';
import { RESOLUTIONS, type Resolution, type SourceKind } from '../sources/source';

/** Picks the input, a webcam or a video file, plus the transport for video. */
export const SourcePanel = () => {
	const source = lab.source;
	const state = useStore(source.state);
	const { inputFpsCap } = useStore(conditions);
	const [kind, setKind] = useState<SourceKind>('webcam');
	const [resolution, setResolution] = useState<Resolution>('720p');
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [deviceId, setDeviceId] = useState<string>('');
	const preview = useRef<HTMLDivElement>(null);

	useEffect(() => {
		preview.current?.replaceChildren(source.video);
	}, [source]);

	const startWebcam = async (id = deviceId) => {
		await source.useWebcam(id || undefined, resolution);
		const all = await navigator.mediaDevices.enumerateDevices();
		setDevices(all.filter((device) => device.kind === 'videoinput'));
	};

	return (
		<section className='panel'>
			<h2>Source</h2>
			<div className='segmented' role='radiogroup' aria-label='Source kind'>
				{(['webcam', 'file'] as const).map((value) => (
					<button key={value} type='button' className={kind === value ? 'on' : ''} onClick={() => setKind(value)}>
						{value === 'file' ? 'Video file' : 'Webcam'}
					</button>
				))}
			</div>
			<label className='param'>
				<span>Webcam resolution</span>
				<select value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)}>
					{Object.keys(RESOLUTIONS).map((value) => (
						<option key={value}>{value}</option>
					))}
				</select>
			</label>
			{kind === 'file' && (
				<label className='file'>
					Open video (or drop one anywhere)
					<input type='file' accept='video/*' onChange={(event) => event.target.files?.[0] && void source.useFile(event.target.files[0])} />
				</label>
			)}
			{kind === 'webcam' && (
				<>
					{devices.length > 0 && (
						<label className='param'>
							<span>Camera</span>
							<select
								value={deviceId}
								onChange={(event) => {
									setDeviceId(event.target.value);
									void startWebcam(event.target.value);
								}}
							>
								{devices.map((device) => (
									<option key={device.deviceId} value={device.deviceId}>
										{device.label || device.deviceId.slice(0, 8)}
									</option>
								))}
							</select>
						</label>
					)}
					<button type='button' onClick={() => void startWebcam()}>
						Start webcam at {resolution}
					</button>
				</>
			)}
			<div className='muted'>
				{state.kind ?? 'none'}: {state.label} · {state.width}x{state.height}
				{state.error && <div className='bad'>{state.error}</div>}
			</div>
			<div ref={preview} className='source-preview' />
			{state.kind === 'file' && (
				<div className='transport'>
					<button type='button' onClick={() => (state.playing ? source.pause() : source.play())}>
						{state.playing ? 'Pause' : 'Play'}
					</button>
					<button type='button' onClick={() => source.step(-1)} title='One frame back'>
						&lt; frame
					</button>
					<button type='button' onClick={() => source.step(1)} title='One frame forward'>
						frame &gt;
					</button>
					<input type='range' min={0} max={state.duration || 0} step={0.001} value={state.currentTime} onChange={(event) => source.seek(Number(event.target.value))} aria-label='Scrub' />
					<span className='muted'>
						{state.currentTime.toFixed(2)} / {state.duration.toFixed(2)} s · {state.frameRate.toFixed(0)} fps
					</span>
				</div>
			)}
			<label className='param'>
				<span>Input fps cap</span>
				<select value={inputFpsCap} onChange={(event) => conditions.update({ inputFpsCap: Number(event.target.value) })}>
					{[0, 60, 30, 24, 15, 10, 5].map((value) => (
						<option key={value} value={value}>
							{value === 0 ? 'none (source rate; stills repeat at 30)' : `${value} fps`}
						</option>
					))}
				</select>
			</label>
		</section>
	);
};
