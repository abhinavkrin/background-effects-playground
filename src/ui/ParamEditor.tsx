import type { ParamSpec, ParamValue, Params } from '../lib/params';

interface ParamEditorProps {
	specs: readonly ParamSpec[];
	values: Params;
	onChange: (key: string, value: ParamValue) => void;
	disabled?: boolean;
}

/** Inputs for a list of parameters: sliders with a number box, checkboxes, selects. */
export const ParamEditor = ({ specs, values, onChange, disabled }: ParamEditorProps) => (
	<div className='params'>
		{specs.map((spec) => {
			const value = values[spec.key];
			if (spec.kind === 'boolean') {
				return (
					<label key={spec.key} className='param param-check' title={spec.help}>
						<input type='checkbox' checked={value === true} disabled={disabled} onChange={(event) => onChange(spec.key, event.target.checked)} />
						{spec.label}
					</label>
				);
			}
			if (spec.kind === 'select') {
				return (
					<label key={spec.key} className='param' title={spec.help}>
						<span>{spec.label}</span>
						<select value={String(value)} disabled={disabled} onChange={(event) => onChange(spec.key, event.target.value)}>
							{spec.options.map((option) => (
								<option key={option}>{option}</option>
							))}
						</select>
					</label>
				);
			}
			const number = typeof value === 'number' ? value : spec.min;
			return (
				<label key={spec.key} className='param' title={spec.help}>
					<span>{spec.label}</span>
					<span className='param-number'>
						<input type='range' min={spec.min} max={spec.max} step={spec.step} value={number} disabled={disabled} onChange={(event) => onChange(spec.key, Number(event.target.value))} />
						<input
							type='number'
							aria-label={spec.label}
							min={spec.min}
							max={spec.max}
							step={spec.step}
							value={number}
							disabled={disabled}
							onChange={(event) => event.target.value !== '' && onChange(spec.key, Number(event.target.value))}
						/>
					</span>
				</label>
			);
		})}
	</div>
);
