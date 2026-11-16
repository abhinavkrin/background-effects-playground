import { useCallback, useEffect, useState } from 'react';
import { clearCache, deleteCached, listCached, verifyCached, type CachedEntry } from '../switching/cache';
import type { PolicyRunner } from '../switching/runner';
import { VERDICT_KEY, clearVerdict, readStoredVerdict } from '../switching/verdict';
import { mb } from './files';

/** What a returning device would find: models in Cache Storage and the persisted verdict. */
export const CachePanel = ({ runner }: { runner: PolicyRunner }) => {
	const [entries, setEntries] = useState<CachedEntry[]>([]);
	const [checks, setChecks] = useState<Record<string, string>>({});
	const [verdict, setVerdict] = useState(readStoredVerdict());
	const refresh = useCallback(async () => {
		setEntries(await listCached());
		setVerdict(readStoredVerdict());
		await runner.refreshCache();
	}, [runner]);
	useEffect(() => {
		void refresh();
		const id = setInterval(() => void refresh(), 3000);
		return () => clearInterval(id);
	}, [refresh]);
	return (
		<div className='cache'>
			<h3>Cache Storage</h3>
			{entries.length === 0 ? (
				<div className='muted'>empty</div>
			) : (
				<table>
					<tbody>
						{entries.map((entry) => (
							<tr key={entry.url}>
								<td>{entry.model?.id ?? entry.url}</td>
								<td>{mb(entry.bytes)}</td>
								<td>{checks[entry.url] ?? ''}</td>
								<td>
									<button
										type='button'
										onClick={async () => {
											const result = await verifyCached(entry);
											setChecks({ ...checks, [entry.url]: result.ok ? 'hash ok' : `MISMATCH ${result.sha256.slice(0, 10)}` });
										}}
									>
										Verify hash
									</button>
									<button type='button' onClick={() => void deleteCached(entry.url).then(refresh)}>
										Delete
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<button type='button' onClick={() => void clearCache().then(refresh)}>
				Clear cache
			</button>
			<h3>Persisted verdict</h3>
			<div className='muted'>localStorage '{VERDICT_KEY}'</div>
			<pre>{verdict ? JSON.stringify({ ...verdict, at: new Date(verdict.at).toISOString(), until: new Date(verdict.until).toISOString() }, null, 1) : 'none'}</pre>
			<button
				type='button'
				onClick={() => {
					clearVerdict();
					setVerdict(null);
				}}
			>
				Clear verdict
			</button>
		</div>
	);
};
