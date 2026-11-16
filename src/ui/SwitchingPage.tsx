import { useEffect, useMemo, useState } from 'react';
import { ENGINE_LABELS, SWITCH_METHODS, type EngineKind, type SwitchMethod } from '../engines/types';
import { Pane } from '../lab/pane';
import type { Params } from '../lib/params';
import { useStore, useTicker } from '../lib/store';
import { LARGE_MODEL_ID, MODELS, SMALL_MODEL_ID } from '../models';
import { STRATEGIES, strategyById } from '../strategies';
import { POLICIES, policyById } from '../switching';
import { PolicyRunner } from '../switching/runner';
import type { ProbeResult } from '../switching/warmup';
import { CachePanel } from './CachePanel';
import { ConditionsPanel } from './ConditionsPanel';
import { mb, ms } from './files';
import { ParamEditor } from './ParamEditor';
import { PaneSurface } from './PaneSurface';
import { TimelineChart } from './TimelineChart';

/** Runs one simulated call under a switching policy, with every condition it reacts to under the user's control. */
export const SwitchingPage = ({ active }: { active: boolean }) => {
	const runner = useMemo(() => new PolicyRunner(new Pane()), []);
	const runnerState = useStore(runner.state);
	const paneState = useStore(runner.pane.state);
	useTicker(1000);
	const [engine, setEngine] = useState<EngineKind>('proposed');
	const [strategyId, setStrategyId] = useState('confidence-adaptive-edges');
	const [policyId, setPolicyId] = useState('gated');
	const [params, setParams] = useState<Record<string, Params>>({});
	const [target, setTarget] = useState(LARGE_MODEL_ID);
	const [method, setMethod] = useState<SwitchMethod>('in-place');
	const [probeModel, setProbeModel] = useState(LARGE_MODEL_ID);
	const [probe, setProbe] = useState<ProbeResult | 'running' | null>(null);
	const policy = policyById(policyId);
	const policyParams = { ...policy.defaults, ...params[policyId] };

	useEffect(() => {
		(window as unknown as { __lab: Record<string, unknown> }).__lab.runner = runner;
		return () => runner.stop();
	}, [runner]);

	const start = () => void runner.start({ policyId, params: policyParams, engine, strategy: strategyById(strategyId) });
	const download = runnerState.download;

	return (
		<div className='page switching'>
			<div className='switching-main'>
				<div className='toolbar'>
					<label>
						Engine
						<select aria-label='Engine' value={engine} onChange={(event) => setEngine(event.target.value as EngineKind)}>
							{(Object.keys(ENGINE_LABELS) as EngineKind[]).map((kind) => (
								<option key={kind} value={kind}>
									{ENGINE_LABELS[kind]}
								</option>
							))}
						</select>
					</label>
					{engine === 'lab' && (
						<label>
							Strategy
							<select aria-label='Strategy' value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
								{STRATEGIES.map((strategy) => (
									<option key={strategy.id} value={strategy.id}>
										{strategy.label}
									</option>
								))}
							</select>
						</label>
					)}
					<label>
						Policy
						<select aria-label='Policy' value={policyId} onChange={(event) => setPolicyId(event.target.value)}>
							{POLICIES.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{entry.label}
								</option>
							))}
						</select>
					</label>
					<button type='button' className='primary' onClick={start}>
						{runnerState.running ? 'Restart call' : 'Start call'}
					</button>
					<button type='button' onClick={() => runner.stop()} disabled={!runnerState.running}>
						End call
					</button>
				</div>
				<div className='status-line'>
					<span>
						state <b data-testid='policy-state'>{runnerState.stateName}</b>
					</span>
					<span>
						model <b data-testid='active-model'>{runnerState.activeModel}</b>
					</span>
					<span>call {runnerState.running ? `${((performance.now() - runnerState.callStartedAt) / 1000).toFixed(0)} s` : 'not running'}</span>
					{download && (
						<span>
							downloading {download.model}: {mb(download.received)} / {mb(download.total)} ({Math.round((download.received / download.total) * 100)}%)
						</span>
					)}
					{runnerState.lastProbe && (
						<span>
							last probe {runnerState.lastProbe.model}: {runnerState.lastProbe.ok ? `compile ${runnerState.lastProbe.createMs} ms, median ${ms(runnerState.lastProbe.readbackMedianMs)}` : runnerState.lastProbe.error}
						</span>
					)}
				</div>
				<PaneSurface pane={runner.pane} active={active} strategyLabel={engine === 'lab' ? strategyById(strategyId).label : engine === 'proposed' ? 'all proposed options' : 'category mask'} />
				<TimelineChart runner={runner} />
				<div className='manual'>
					<label>
						Switch to
						<select aria-label='Switch to' value={target} onChange={(event) => setTarget(event.target.value)}>
							{MODELS.map((model) => (
								<option key={model.id} value={model.id}>
									{model.label}
								</option>
							))}
						</select>
					</label>
					<label>
						Method
						<select aria-label='Method' value={method} onChange={(event) => setMethod(event.target.value as SwitchMethod)}>
							{SWITCH_METHODS.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{entry.label}
								</option>
							))}
						</select>
					</label>
					<button type='button' disabled={!runner.pane.engine} onClick={() => void runner.manualSwitch(target, method)}>
						Switch now
					</button>
					<button type='button' onClick={() => void runner.manualSwitch(SMALL_MODEL_ID, method)} disabled={!runner.pane.engine}>
						Back to small
					</button>
					<button type='button' onClick={() => void runner.manualDownload(LARGE_MODEL_ID).catch(() => undefined)}>
						Download large (simulated network)
					</button>
				</div>
				<div className='manual'>
					<label>
						Worker warm-up probe
						<select aria-label='Probe model' value={probeModel} onChange={(event) => setProbeModel(event.target.value)}>
							{MODELS.map((model) => (
								<option key={model.id} value={model.id}>
									{model.label}
								</option>
							))}
						</select>
					</label>
					<button
						type='button'
						disabled={probe === 'running'}
						onClick={async () => {
							setProbe('running');
							setProbe(await runner.manualProbe(probeModel));
						}}
					>
						Run probe
					</button>
					{probe === 'running' && <span>running in a classic Worker...</span>}
					{probe && probe !== 'running' && (
						<span data-testid='probe-result'>
							{probe.ok
								? `compile (createFromOptions) ${probe.createMs} ms, first inference ${probe.firstInferenceMs} ms, readback median ${ms(probe.readbackMedianMs)}, p90 ${ms(probe.readbackP90Ms)}, total ${ms(probe.totalMs, 0)}`
								: `failed: ${probe.error}`}
						</span>
					)}
				</div>
				<h3>Switches</h3>
				<table className='switches'>
					<thead>
						<tr>
							<th>at</th>
							<th>method</th>
							<th>from to</th>
							<th>call</th>
							<th>max gap</th>
							<th>frames in 3 s</th>
							<th>slowest frame</th>
							<th>raw flashes</th>
							<th>wasm heap</th>
							<th>result</th>
						</tr>
					</thead>
					<tbody>
						{paneState.switches.map((entry, i) => (
							<tr key={i}>
								<td>{runnerState.callStartedAt ? `${((entry.startedAt - runnerState.callStartedAt) / 1000).toFixed(1)} s` : '-'}</td>
								<td>{entry.method}</td>
								<td>
									{entry.from} {'->'} {entry.to}
								</td>
								<td>{ms(entry.callMs, 0)}</td>
								<td>{entry.measured ? ms(entry.maxGapMs, 0) : '...'}</td>
								<td>{entry.framesInWindow ?? '...'}</td>
								<td>{entry.measured ? ms(entry.slowestFrameMs, 0) : '...'}</td>
								<td>{entry.measured ? `${entry.rawFlashes} seen, ${entry.rawReported} sent raw` : '...'}</td>
								<td>
									{mb(entry.heapBefore)} {'->'} {mb(entry.heapAfter)}
								</td>
								<td className={entry.ok ? '' : 'bad'}>{entry.ok ? 'ok' : entry.error}</td>
							</tr>
						))}
					</tbody>
				</table>
				<h3>Events</h3>
				<div className='events'>
					{[...runner.events].reverse().map((event, i) => (
						<div key={i} className={event.ok === false ? 'bad' : ''}>
							<span className='muted'>{event.t.toFixed(1)} s</span> [{event.kind}] {event.label}
						</div>
					))}
				</div>
			</div>
			<div className='switching-side'>
				<details open>
					<summary>Policy parameters ({policy.label})</summary>
					<div className='muted'>{policy.description}</div>
					<ParamEditor specs={policy.params} values={policyParams} onChange={(key, value) => setParams({ ...params, [policyId]: { ...params[policyId], [key]: value } })} />
					{policy.params.length > 0 && (
						<button type='button' onClick={() => setParams({ ...params, [policyId]: {} })}>
							Reset to defaults
						</button>
					)}
					<div className='muted'>Changes apply on the next Start call.</div>
				</details>
				<details open>
					<summary>Conditions (simulators)</summary>
					<ConditionsPanel />
				</details>
				<details open>
					<summary>Cache and verdict</summary>
					<CachePanel runner={runner} />
				</details>
			</div>
		</div>
	);
};
