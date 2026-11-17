import type { ParamValue } from '../lib/params';
import { PASSES, passById, type PassConfig, type PassStage } from '../passes';
import { COMPOSITE_DEFAULTS, COMPOSITE_PARAMS } from '../passes/composite';
import type { Strategy } from '../strategies';
import { ParamEditor } from './ParamEditor';

interface StrategyEditorProps {
	strategy: Strategy;
	onChange: (strategy: Strategy) => void;
}

/** A TypeScript file for src/strategies/, so an edited strategy can become a preset. */
const asCode = (strategy: Strategy): string => {
	const name = strategy.id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
	return `import type { Strategy } from './types';\n\nexport const ${name}: Strategy = ${JSON.stringify(strategy, null, '\t')};\n`;
};

/** Every pass of a lab strategy: toggle, tune, reorder, add, remove. */
export const StrategyEditor = ({ strategy, onChange }: StrategyEditorProps) => {
	const setStage = (stage: PassStage, entries: PassConfig[]) => onChange({ ...strategy, [stage]: entries });
	const stage = (name: PassStage) => {
		const entries = strategy[name];
		const update = (index: number, entry: PassConfig) => setStage(name, entries.map((current, i) => (i === index ? entry : current)));
		const move = (index: number, by: number) => {
			const next = [...entries];
			const [entry] = next.splice(index, 1);
			next.splice(Math.max(0, Math.min(next.length, index + by)), 0, entry);
			setStage(name, next);
		};
		return (
			<div className='stage'>
				<div className='stage-title'>{name === 'mask' ? 'Mask passes (per segmentation)' : 'Frame passes (per frame, before the composite)'}</div>
				{entries.map((entry, index) => {
					const definition = passById(entry.pass);
					return (
						<div key={`${entry.pass}-${index}`} className={`pass ${entry.enabled ? '' : 'pass-off'}`}>
							<div className='pass-head'>
								<label className='param-check' title={definition.description}>
									<input type='checkbox' checked={entry.enabled} onChange={(event) => update(index, { ...entry, enabled: event.target.checked })} />
									{definition.label}
								</label>
								<span className='pass-tools'>
									<button type='button' onClick={() => move(index, -1)} disabled={index === 0} title='Earlier'>
										up
									</button>
									<button type='button' onClick={() => move(index, 1)} disabled={index === entries.length - 1} title='Later'>
										down
									</button>
									<button type='button' onClick={() => setStage(name, entries.filter((_, i) => i !== index))} title='Remove'>
										x
									</button>
								</span>
							</div>
							{definition.params.length > 0 && (
								<ParamEditor
									specs={definition.params}
									values={{ ...definition.defaults, ...entry.params }}
									disabled={!entry.enabled}
									onChange={(key: string, value: ParamValue) => update(index, { ...entry, params: { ...entry.params, [key]: value } })}
								/>
							)}
						</div>
					);
				})}
				<select
					value=''
					aria-label={`Add a ${name} pass`}
					onChange={(event) => {
						const definition = passById(event.target.value);
						setStage(name, [...entries, { pass: definition.id, enabled: true, params: { ...definition.defaults } }]);
					}}
				>
					<option value=''>+ add a {name} pass</option>
					{PASSES.filter((pass) => pass.stage === name).map((pass) => (
						<option key={pass.id} value={pass.id}>
							{pass.label}
						</option>
					))}
				</select>
			</div>
		);
	};
	return (
		<div className='strategy-editor'>
			<label className='param'>
				<span>Segmenter output</span>
				<select value={strategy.segmenterOutput} onChange={(event) => onChange({ ...strategy, segmenterOutput: event.target.value as Strategy['segmenterOutput'] })}>
					<option value='confidence'>confidence masks</option>
					<option value='category'>category mask (hard cut)</option>
				</select>
			</label>
			<label className='param param-check' title='resetSharedState() before the mask and frame stages'>
				<input type='checkbox' checked={strategy.glReset} onChange={(event) => onChange({ ...strategy, glReset: event.target.checked })} />
				GL state reset (needed for multiclass on GPU)
			</label>
			<ParamEditor
				specs={[{ key: 'maskTargetEdge', label: 'Mask buffer long edge (px)', kind: 'number', min: 128, max: 1920, step: 32 }]}
				values={{ maskTargetEdge: strategy.maskTargetEdge }}
				onChange={(_, value) => onChange({ ...strategy, maskTargetEdge: Number(value) })}
			/>
			{stage('mask')}
			{stage('frame')}
			<div className='stage'>
				<div className='stage-title'>Composite</div>
				<ParamEditor specs={COMPOSITE_PARAMS} values={{ ...COMPOSITE_DEFAULTS, ...strategy.composite }} onChange={(key, value) => onChange({ ...strategy, composite: { ...strategy.composite, [key]: value } })} />
			</div>
			<button type='button' onClick={() => void navigator.clipboard.writeText(asCode(strategy))} title='Paste into src/strategies/<id>.ts and list it in src/strategies/index.ts'>
				Copy as a strategy file
			</button>
		</div>
	);
};
