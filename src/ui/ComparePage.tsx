import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_OPTIONS_ON, ENGINE_LABELS, LIBRARY_DEFAULTS, SWITCH_METHODS, describeLibrary, type EngineKind, type LibraryOptions, type SwitchMethod } from '../engines/types';
import { lab } from '../lab/lab';
import { Pane, type PaneConfig } from '../lab/pane';
import { useStore } from '../lib/store';
import { MODELS, loadModelBytes, modelById } from '../models';
import { VIEW_MODES, type ViewMode } from '../passes/composite';
import { conditions } from '../sim/conditions';
import { STRATEGIES, cloneStrategy, strategyById, type Strategy } from '../strategies';
import { saveBlob, stamp } from './files';
import { LibraryOptionsEditor } from './LibraryOptionsEditor';
import { PaneSurface } from './PaneSurface';
import { StrategyEditor } from './StrategyEditor';

interface ComparePaneConfig extends PaneConfig {
	presetId: string;
	edited: boolean;
	library: LibraryOptions;
}

const config = (engine: EngineKind, modelId: string, presetId: string, library = LIBRARY_DEFAULTS): ComparePaneConfig => ({
	engine,
	modelId,
	presetId,
	edited: false,
	strategy: cloneStrategy(strategyById(presetId)),
	view: 'effect',
	library,
});

const DEFAULTS: ComparePaneConfig[] = [
	config('library', 'selfie-landscape', 'category-box-blur'),
	config('library', 'selfie-multiclass-fp16', 'confidence-adaptive-edges', ALL_OPTIONS_ON),
	config('lab', 'selfie-multiclass-fp16', 'confidence-opacity'),
	config('lab', 'selfie-multiclass-fp16', 'confidence-only'),
];

const labelOf = (entry: ComparePaneConfig) =>
	entry.engine === 'lab' ? `${strategyById(entry.presetId).label}${entry.edited ? ' (edited)' : ''}` : describeLibrary(entry.library);

interface ComparePaneProps {
	pane: Pane;
	index: number;
	value: ComparePaneConfig;
	onChange: (value: ComparePaneConfig) => void;
	active: boolean;
	switchMethod: SwitchMethod;
}

/** One compare pane: its engine starts when the engine or the library options change; a model change switches in place. */
const ComparePane = ({ pane, index, value, onChange, active, switchMethod }: ComparePaneProps) => {
	const appliedModel = useRef(value.modelId);
	const state = useStore(pane.state);

	useEffect(() => {
		const { width, height } = lab.source.state.get();
		appliedModel.current = value.modelId;
		void pane.start(value, lab.background.get(), { width, height });
		// The library takes its options at construction; the rest is applied to the running engine below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pane, value.engine, value.engine === 'library' && value.library]);

	useEffect(() => () => void pane.dispose(), [pane]);

	useEffect(() => {
		if (state.status !== 'ready' || appliedModel.current === value.modelId) {
			return;
		}
		appliedModel.current = value.modelId;
		const model = modelById(value.modelId);
		void loadModelBytes(model).then((bytes) => pane.switchModel(model, bytes, switchMethod));
	}, [pane, state.status, value.modelId, switchMethod]);

	useEffect(() => void pane.setStrategy(value.strategy), [pane, value.strategy]);
	useEffect(() => pane.setView(value.view), [pane, value.view, state.status]);

	const last = state.switches[state.switches.length - 1];
	return (
		<PaneSurface
			pane={pane}
			active={active}
			strategyLabel={labelOf(value)}
			header={
				<div className='pane-head'>
					<b>{String.fromCharCode(65 + index)}</b>
					<label>
						Engine
						<select aria-label='Engine' value={value.engine} onChange={(event) => onChange({ ...value, engine: event.target.value as EngineKind })}>
							{(Object.keys(ENGINE_LABELS) as EngineKind[]).map((kind) => (
								<option key={kind} value={kind}>
									{ENGINE_LABELS[kind]}
								</option>
							))}
						</select>
					</label>
					<label>
						Model
						<select aria-label='Model' value={value.modelId} onChange={(event) => onChange({ ...value, modelId: event.target.value })}>
							{MODELS.map((model) => (
								<option key={model.id} value={model.id}>
									{model.label}
								</option>
							))}
						</select>
					</label>
					{value.engine === 'library' && <LibraryOptionsEditor value={value.library} onChange={(library) => onChange({ ...value, library })} />}
					{value.engine === 'lab' && (
						<>
							<label>
								Strategy
								<select aria-label='Strategy' value={value.presetId} onChange={(event) => onChange({ ...value, presetId: event.target.value, edited: false, strategy: cloneStrategy(strategyById(event.target.value)) })}>
									{STRATEGIES.map((strategy) => (
										<option key={strategy.id} value={strategy.id}>
											{strategy.label}
										</option>
									))}
								</select>
							</label>
							<label>
								View
								<select aria-label='View' value={value.view} onChange={(event) => onChange({ ...value, view: event.target.value as ViewMode })}>
									{VIEW_MODES.map((mode) => (
										<option key={mode.id} value={mode.id}>
											{mode.label}
										</option>
									))}
								</select>
							</label>
						</>
					)}
				</div>
			}
			footer={
				<>
					{last && (
						<span className='muted'>
							last switch: {last.method} {last.ok ? `${last.callMs.toFixed(0)} ms call` : `failed: ${last.error}`}
							{last.measured && `, max gap ${last.maxGapMs?.toFixed(0)} ms, raw flashes ${last.rawFlashes}`}
						</span>
					)}
					{value.engine === 'lab' && (
						<details className='editor'>
							<summary>Edit strategy</summary>
							<StrategyEditor strategy={value.strategy} onChange={(strategy: Strategy) => onChange({ ...value, strategy, edited: true })} />
						</details>
					)}
				</>
			}
		/>
	);
};

/** Draws two panes into one canvas split at a movable line. */
const Wipe = ({ panes }: { panes: [Pane, Pane] }) => {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [split, setSplit] = useState(50);
	const splitRef = useRef(split);
	splitRef.current = split;
	useEffect(() => {
		let frame = 0;
		const draw = () => {
			const target = canvas.current;
			const context = target?.getContext('2d');
			const [a, b] = panes.map((pane) => pane.engine?.element);
			if (target && context && a && b) {
				const width = (a instanceof HTMLVideoElement ? a.videoWidth : a.width) || 1280;
				const height = (a instanceof HTMLVideoElement ? a.videoHeight : a.height) || 720;
				if (target.width !== width || target.height !== height) {
					target.width = width;
					target.height = height;
				}
				const x = Math.round((width * splitRef.current) / 100);
				context.drawImage(a, 0, 0, width, height);
				context.save();
				context.beginPath();
				context.rect(x, 0, width - x, height);
				context.clip();
				context.drawImage(b, 0, 0, width, height);
				context.restore();
				context.fillStyle = '#ffd400';
				context.fillRect(x - 1, 0, 2, height);
			}
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [panes]);
	return (
		<div className='wipe'>
			<div className='muted'>A on the left, B on the right</div>
			<canvas ref={canvas} />
			<input type='range' min={0} max={100} value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label='Wipe position' />
		</div>
	);
};

/** Labels each pane's current output and saves them as one PNG. */
const snapshot = (panes: Pane[], configs: ComparePaneConfig[]) => {
	const cellWidth = 960;
	const cellHeight = 540;
	const labelHeight = 28;
	const columns = panes.length === 1 ? 1 : 2;
	const rows = Math.ceil(panes.length / columns);
	const canvas = document.createElement('canvas');
	canvas.width = cellWidth * columns;
	canvas.height = (cellHeight + labelHeight) * rows;
	const context = canvas.getContext('2d');
	if (!context) {
		return;
	}
	context.fillStyle = '#111';
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.font = '16px system-ui, sans-serif';
	panes.forEach((pane, i) => {
		const x = (i % columns) * cellWidth;
		const y = Math.floor(i / columns) * (cellHeight + labelHeight);
		const element = pane.engine?.element;
		if (element) {
			const width = (element instanceof HTMLVideoElement ? element.videoWidth : element.width) || 16;
			const height = (element instanceof HTMLVideoElement ? element.videoHeight : element.height) || 9;
			const scale = Math.min(cellWidth / width, cellHeight / height);
			context.drawImage(element, x + (cellWidth - width * scale) / 2, y + labelHeight, width * scale, height * scale);
		}
		const entry = configs[i];
		context.fillStyle = '#eee';
		context.fillText(`${String.fromCharCode(65 + i)}: ${ENGINE_LABELS[entry.engine]} · ${modelById(entry.modelId).label} · ${labelOf(entry)} · ${entry.view}`, x + 8, y + 20);
	});
	canvas.toBlob((blob) => blob && saveBlob(blob, `snapshot-${stamp()}.png`), 'image/png');
};

export const ComparePage = ({ active }: { active: boolean }) => {
	const [count, setCount] = useState(2);
	const [configs, setConfigs] = useState(DEFAULTS);
	const [wipe, setWipe] = useState(false);
	const [switchMethod, setSwitchMethod] = useState<SwitchMethod>('in-place');
	const panes = useMemo(() => DEFAULTS.map(() => new Pane()), []);
	const { gpuProbe } = useStore(conditions);
	const visible = panes.slice(0, count);

	useEffect(() => {
		(window as unknown as { __lab: Record<string, unknown> }).__lab.comparePanes = panes;
	}, [panes]);

	return (
		<div className='page'>
			<div className='toolbar'>
				<label>
					Panes
					<select aria-label='Panes' value={count} onChange={(event) => setCount(Number(event.target.value))}>
						<option value={1}>1</option>
						<option value={2}>2</option>
						<option value={4}>4</option>
					</select>
				</label>
				<label className='param-check'>
					<input type='checkbox' checked={wipe} disabled={count < 2} onChange={(event) => setWipe(event.target.checked)} />
					A/B wipe
				</label>
				<label title='How a pane moves to another model when you pick one'>
					Model change
					<select value={switchMethod} onChange={(event) => setSwitchMethod(event.target.value as SwitchMethod)}>
						{SWITCH_METHODS.map((method) => (
							<option key={method.id} value={method.id}>
								{method.label}
							</option>
						))}
					</select>
				</label>
				<label className='param-check' title='Reads one pixel back after each frame to time the GPU; costs throughput'>
					<input type='checkbox' checked={gpuProbe} onChange={(event) => conditions.update({ gpuProbe: event.target.checked })} />
					GPU readback probe
				</label>
				<button type='button' onClick={() => snapshot(visible, configs.slice(0, count))}>
					Snapshot (PNG)
				</button>
			</div>
			{wipe && count >= 2 && <Wipe panes={[panes[0], panes[1]]} />}
			<div className={`grid grid-${count}`}>
				{panes.map((pane, index) =>
					index < count ? (
						<ComparePane
							key={pane.id}
							pane={pane}
							index={index}
							value={configs[index]}
							active={active}
							switchMethod={switchMethod}
							onChange={(next) => setConfigs(configs.map((entry, i) => (i === index ? next : entry)))}
						/>
					) : null,
				)}
			</div>
		</div>
	);
};
