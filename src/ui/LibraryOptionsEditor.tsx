import type { LibraryOptions } from '../engines/types';

interface LibraryOptionsEditorProps {
	value: LibraryOptions;
	onChange: (value: LibraryOptions) => void;
}

interface NumberBoxProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	disabled: boolean;
	onChange: (value: number) => void;
}

const NumberBox = ({ label, value, min, max, step, disabled, onChange }: NumberBoxProps) => (
	<input
		type='number'
		aria-label={label}
		min={min}
		max={max}
		step={step}
		value={value}
		disabled={disabled}
		onChange={(event) => event.target.value !== '' && onChange(Number(event.target.value))}
	/>
);

/** The BackgroundProcessor mask options, each with what it does. */
export const LibraryOptionsEditor = ({ value, onChange }: LibraryOptionsEditorProps) => {
	const alpha = value.maskBlending === 'alpha';
	const [low, high] = value.alphaRange;
	return (
		<div className='options'>
			<label className='option'>
				<span className='option-head'>
					<code>maskBlending</code>
					<select aria-label='maskBlending' value={value.maskBlending} onChange={(event) => onChange({ ...value, maskBlending: event.target.value as LibraryOptions['maskBlending'] })}>
						<option value='alpha'>'alpha'</option>
						<option value='binary'>'binary'</option>
					</select>
				</span>
				<span className='option-sub'>
					Alpha (the default): the confidence mask, 0 to 1, is each pixel's opacity, so hair stays soft and multiclass models work. Binary: the category
					mask, cut at 0.5 with a feathered edge.
				</span>
			</label>
			<div className='option'>
				<span className='option-head'>
					<code>alphaRange</code>
					<NumberBox label='alphaRange low' value={low} min={0} max={1} step={0.05} disabled={!alpha} onChange={(next) => onChange({ ...value, alphaRange: [next, high] })} />
					<NumberBox label='alphaRange high' value={high} min={0} max={1} step={0.05} disabled={!alpha} onChange={(next) => onChange({ ...value, alphaRange: [low, next] })} />
				</span>
				<span className='option-sub'>smoothstep(low, high) on the confidence before it is used as opacity: faint ghosts drop out, the body is fully solid. [0, 1] leaves it as is.</span>
			</div>
			<label className='option'>
				<span className='option-head'>
					<input type='checkbox' checked={value.temporalSmoothing} onChange={(event) => onChange({ ...value, temporalSmoothing: event.target.checked })} />
					<code>temporalSmoothing</code>
				</span>
				<span className='option-sub'>Motion-adaptive EMA of the mask: keeps 15% of the new mask where the frame is still, up to 90% where it moves.</span>
			</label>
			<div className='option'>
				<label className='option-head'>
					<input type='checkbox' checked={value.edgeRefinement} onChange={(event) => onChange({ ...value, edgeRefinement: event.target.checked })} />
					<code>edgeRefinement</code>
				</label>
				<span className='option-head'>
					<code>edgeRefinementRadius</code>
					<NumberBox
						label='edgeRefinementRadius'
						value={value.edgeRefinementRadius}
						min={1}
						max={8}
						step={1}
						disabled={!value.edgeRefinement}
						onChange={(next) => onChange({ ...value, edgeRefinementRadius: next })}
					/>
				</span>
				<span className='option-sub'>
					Joint bilateral filter guided by the frame: each mask pixel takes the mask of nearby pixels of similar colour, so the edge snaps to the outline. The
					radius (default 4) sets how far it looks: (2r + 1)² samples per pixel.
				</span>
			</div>
		</div>
	);
};
