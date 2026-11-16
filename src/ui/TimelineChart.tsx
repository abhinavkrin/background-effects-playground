import { useEffect, useRef } from 'react';
import { LARGE_MODEL_ID } from '../models';
import type { PolicyRunner, TimelineEventKind } from '../switching/runner';

const EVENT_COLORS: Record<TimelineEventKind, string> = {
	start: '#9aa0a6',
	'download-start': '#4fc3f7',
	'download-end': '#0288d1',
	probe: '#ba68c8',
	swap: '#ffd54f',
	probation: '#81c784',
	downgrade: '#e57373',
	persist: '#a1887f',
	recover: '#ff8a65',
	note: '#757575',
	error: '#ff1744',
};

const STATE_COLORS = ['#37474f', '#455a64', '#1565c0', '#6a1b9a', '#2e7d32', '#00695c', '#ad1457', '#4e342e'];

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#ccc';

/** Ratio, frame time, active model, policy state and events of the running call, redrawn twice a second. */
export const TimelineChart = ({ runner, windowS = 180 }: { runner: PolicyRunner; windowS?: number }) => {
	const canvas = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const draw = () => {
			const target = canvas.current;
			const context = target?.getContext('2d');
			if (!target || !context) {
				return;
			}
			const ratioScale = window.devicePixelRatio || 1;
			const width = target.clientWidth;
			const height = target.clientHeight;
			if (target.width !== width * ratioScale || target.height !== height * ratioScale) {
				target.width = width * ratioScale;
				target.height = height * ratioScale;
			}
			context.setTransform(ratioScale, 0, 0, ratioScale, 0, 0);
			context.clearRect(0, 0, width, height);
			context.font = '11px system-ui, sans-serif';
			const text = css('--text');
			const grid = css('--border');
			const samples = runner.samples;
			const end = Math.max(windowS, samples[samples.length - 1]?.t ?? 0);
			const start = end - windowS;
			const left = 44;
			const plotWidth = width - left - 8;
			const x = (t: number) => left + ((t - start) / windowS) * plotWidth;

			// Lanes: ratio (top), frame time, model band, state band, events.
			const ratioTop = 8;
			const ratioHeight = height * 0.38;
			const frameTop = ratioTop + ratioHeight + 10;
			const frameHeight = height * 0.22;
			const modelTop = frameTop + frameHeight + 8;
			const stateTop = modelTop + 16;
			const eventTop = stateTop + 20;

			const ratioY = (value: number) => ratioTop + ratioHeight * (1 - Math.min(1.2, value) / 1.2);
			context.strokeStyle = grid;
			context.fillStyle = text;
			context.lineWidth = 1;
			for (const [value, label] of [
				[1, '1.0'],
				[0.95, '0.95'],
				[0.9, '0.9'],
				[0.8, '0.8'],
			] as const) {
				context.setLineDash(value === 1 ? [] : [3, 3]);
				context.beginPath();
				context.moveTo(left, ratioY(value));
				context.lineTo(width - 8, ratioY(value));
				context.stroke();
				context.fillText(label, 4, ratioY(value) + 4);
			}
			context.setLineDash([]);
			context.fillText('ratio', 4, ratioTop + 8);

			const line = (values: Array<[number, number | null | undefined]>, y: (v: number) => number, color: string) => {
				context.strokeStyle = color;
				context.lineWidth = 1.5;
				context.beginPath();
				let open = false;
				for (const [t, value] of values) {
					if (t < start || value === null || value === undefined) {
						open = false;
						continue;
					}
					if (open) {
						context.lineTo(x(t), y(value));
					} else {
						context.moveTo(x(t), y(value));
						open = true;
					}
				}
				context.stroke();
			};
			line(samples.map((s) => [s.t, s.ratio]), ratioY, css('--accent'));

			const maxFrame = Math.max(40, ...samples.filter((s) => s.t >= start).map((s) => s.frameP90 ?? 0));
			const frameY = (value: number) => frameTop + frameHeight * (1 - value / maxFrame);
			context.strokeStyle = grid;
			context.strokeRect(left, frameTop, plotWidth, frameHeight);
			context.fillStyle = text;
			context.fillText(`${Math.round(maxFrame)} ms`, 4, frameTop + 8);
			context.fillText('frame', 4, frameTop + frameHeight);
			line(samples.map((s) => [s.t, s.frameP90]), frameY, '#ef9a9a');
			line(samples.map((s) => [s.t, s.frameP50]), frameY, '#e57373');

			const band = (top: number, key: (s: (typeof samples)[number]) => string, color: (value: string) => string, label: string) => {
				context.fillStyle = text;
				context.fillText(label, 4, top + 11);
				let segmentStart = 0;
				for (let i = 0; i < samples.length; i++) {
					const value = key(samples[i]);
					const next = samples[i + 1];
					if (!next || key(next) !== value) {
						const from = Math.max(start, samples[segmentStart].t - 1);
						const to = samples[i].t;
						if (to >= start) {
							context.fillStyle = color(value);
							context.fillRect(x(from), top, Math.max(1, x(to) - x(from)), 14);
							context.fillStyle = '#fff';
							if (x(to) - x(from) > 60) {
								context.fillText(value, x(from) + 3, top + 11);
							}
						}
						segmentStart = i + 1;
					}
				}
			};
			const states: string[] = [];
			band(modelTop, (s) => s.model, (value) => (value === LARGE_MODEL_ID ? '#6a1b9a' : '#1565c0'), 'model');
			band(
				stateTop,
				(s) => s.state,
				(value) => {
					if (!states.includes(value)) {
						states.push(value);
					}
					return STATE_COLORS[states.indexOf(value) % STATE_COLORS.length];
				},
				'state',
			);

			let row = 0;
			for (const event of runner.events) {
				if (event.t < start) {
					continue;
				}
				const ex = x(event.t);
				context.strokeStyle = event.ok === false ? EVENT_COLORS.error : EVENT_COLORS[event.kind];
				context.beginPath();
				context.moveTo(ex, ratioTop);
				context.lineTo(ex, eventTop + 4);
				context.stroke();
				if (event.kind !== 'note') {
					context.fillStyle = context.strokeStyle;
					context.fillText(event.kind, ex + 2, eventTop + 12 + (row % 3) * 12);
					row++;
				}
			}
			context.fillStyle = text;
			context.fillText(`${Math.max(0, start).toFixed(0)} s`, left, height - 2);
			context.fillText(`${end.toFixed(0)} s`, width - 40, height - 2);
		};
		draw();
		const id = setInterval(draw, 500);
		return () => clearInterval(id);
	}, [runner, windowS]);
	return <canvas ref={canvas} className='timeline' />;
};
