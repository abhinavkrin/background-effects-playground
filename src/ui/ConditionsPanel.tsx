import type { ParamSpec } from '../lib/params';
import { useStore } from '../lib/store';
import { DEFAULT_CONDITIONS, conditions, type Conditions } from '../sim/conditions';
import { deviceSignals, realRendererString } from '../switching/signals';
import { ParamEditor } from './ParamEditor';

const LOAD: ParamSpec[] = [
	{ key: 'cpuBusyMs', label: 'CPU load: busy-wait per frame (ms)', kind: 'number', min: 0, max: 100, step: 1 },
	{ key: 'gpuExtraPasses', label: 'GPU load: extra passes per frame', kind: 'number', min: 0, max: 60, step: 1 },
	{ key: 'gpuIterations', label: 'GPU load: work per pass', kind: 'number', min: 8, max: 1024, step: 8 },
	{ key: 'inputFpsCap', label: 'Input fps cap (0 = source)', kind: 'number', min: 0, max: 60, step: 1 },
];

const NETWORK: ParamSpec[] = [
	{ key: 'downloadKbps', label: 'Download pace (kbps, 0 = full speed)', kind: 'number', min: 0, max: 50000, step: 250 },
	{ key: 'downloadLatencyMs', label: 'Latency before first byte (ms)', kind: 'number', min: 0, max: 5000, step: 50 },
	{ key: 'downloadFailAtPercent', label: 'Fail at % (0 = never)', kind: 'number', min: 0, max: 99, step: 1 },
	{ key: 'downloadTruncatePercent', label: 'Truncate at % (0 = whole file)', kind: 'number', min: 0, max: 99, step: 1 },
	{ key: 'downloadCorrupt', label: 'Corrupt 256 bytes mid-file', kind: 'boolean' },
	{ key: 'skipHashCheck', label: 'Skip length + SHA-256 check (unsafe)', kind: 'boolean' },
	{ key: 'skipWorkerProbe', label: 'Skip worker probe (unsafe)', kind: 'boolean' },
];

/** A select for a nullable override: "real" or a fixed value. */
const Override = <K extends keyof Conditions>({ name, label, options }: { name: K; label: string; options: Array<{ value: Conditions[K]; label: string }> }) => {
	const value = useStore(conditions)[name];
	const index = options.findIndex((option) => option.value === value);
	return (
		<label className='param'>
			<span>{label}</span>
			<select value={index} onChange={(event) => conditions.update({ [name]: options[Number(event.target.value)].value } as Partial<Conditions>)}>
				{options.map((option, i) => (
					<option key={option.label} value={i}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
};

/** Every simulated condition the switching policies react to. */
export const ConditionsPanel = () => {
	const current = useStore(conditions);
	const device = deviceSignals();
	const set = (key: string, value: unknown) => conditions.update({ [key]: value } as Partial<Conditions>);
	return (
		<div className='conditions'>
			<h3>Load</h3>
			<ParamEditor specs={LOAD} values={current as unknown as Record<string, number>} onChange={set} />
			<h3>Device signals</h3>
			<div className='muted'>
				seen: renderer "{device.renderer}", memory {device.deviceMemory ?? '?'} GB, cores {device.hardwareConcurrency ?? '?'}, saveData {String(device.saveData ?? '?')}, mobile {String(device.mobile ?? '?')}
			</div>
			<Override
				name='renderer'
				label='Renderer'
				options={[
					{ value: null, label: `real (${realRendererString().slice(0, 40)})` },
					{ value: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', label: 'Apple M3 Pro (Metal)' },
					{ value: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', label: 'Intel UHD 620 (D3D11)' },
					{ value: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', label: 'SwiftShader (software)' },
					{ value: 'llvmpipe (LLVM 15.0.7, 256 bits)', label: 'llvmpipe (software)' },
				]}
			/>
			<Override name='deviceMemory' label='deviceMemory' options={[{ value: null, label: 'real' }, ...[1, 2, 4, 8].map((value) => ({ value, label: `${value} GB` }))]} />
			<Override name='hardwareConcurrency' label='hardwareConcurrency' options={[{ value: null, label: 'real' }, ...[2, 4, 8, 12].map((value) => ({ value, label: String(value) }))]} />
			<Override name='saveData' label='saveData' options={[{ value: null, label: 'real' }, { value: true, label: 'on' }, { value: false, label: 'off' }]} />
			<Override name='mobile' label='userAgentData.mobile' options={[{ value: null, label: 'real' }, { value: true, label: 'mobile' }, { value: false, label: 'desktop' }]} />
			<Override name='effectiveType' label='effectiveType' options={[{ value: null, label: 'real' }, ...['4g', '3g', '2g', 'slow-2g'].map((value) => ({ value, label: value }))]} />
			<h3>Call</h3>
			<Override name='connectionQuality' label='Connection quality' options={(['excellent', 'good', 'poor', 'lost'] as const).map((value) => ({ value, label: value }))} />
			<Override name='pressure' label='Compute pressure' options={[{ value: null, label: 'real (PressureObserver)' }, ...(['nominal', 'fair', 'serious', 'critical'] as const).map((value) => ({ value, label: value }))]} />
			<label className='param param-check'>
				<input type='checkbox' checked={current.cpuLimited} onChange={(event) => set('cpuLimited', event.target.checked)} />
				qualityLimitationReason = 'cpu'
			</label>
			<label className='param param-check'>
				<input type='checkbox' checked={current.tabHidden} onChange={(event) => set('tabHidden', event.target.checked)} />
				Tab hidden
			</label>
			<h3>Model download</h3>
			<ParamEditor specs={NETWORK} values={current as unknown as Record<string, number | boolean>} onChange={set} />
			<button type='button' onClick={() => conditions.set({ ...DEFAULT_CONDITIONS, gpuProbe: current.gpuProbe })}>
				Reset all conditions
			</button>
		</div>
	);
};
