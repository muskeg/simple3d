import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { describeStatus, ELAPSED_AFTER_MS } from '../lib/status.js';

const DONE_VISIBLE_MS = 2000;

/**
 * Viewport pill for background work: model builds (after a short delay so
 * quick rebuilds don't flicker), engine start-up and file processing. Long
 * builds show elapsed time and briefly report their duration when done.
 */
export default function BuildStatus({ building, activity, initializing }) {
	const active = initializing || !!activity || building;
	const startedRef = useRef(null);
	const [since, setSince] = useState(null);
	const [now, setNow] = useState(() => performance.now());
	const [done, setDone] = useState(null);

	useEffect(() => {
		if (active) {
			startedRef.current ??= performance.now();
			setSince(startedRef.current);
			setNow(performance.now());
			setDone(null);
			return undefined;
		}
		const started = startedRef.current;
		startedRef.current = null;
		setSince(null);
		if (started === null || performance.now() - started <= ELAPSED_AFTER_MS) return undefined;
		setDone(performance.now() - started);
		const timer = setTimeout(() => setDone(null), DONE_VISIBLE_MS);
		return () => clearTimeout(timer);
	}, [active]);

	useEffect(() => {
		if (since === null) return undefined;
		const interval = setInterval(() => setNow(performance.now()), 100);
		return () => clearInterval(interval);
	}, [since]);

	// Read the clock at render so a late interval tick on a busy page never shows a stale time.
	const elapsed = since === null ? 0 : Math.max(0, Math.max(now, performance.now()) - since);
	const status = describeStatus({ initializing, activity, building, elapsed, done });
	const pill = 'pointer-events-none flex items-center gap-2 rounded-full border border-white/10 bg-neutral-900/90 px-3 py-1.5 text-xs text-neutral-200 shadow-lg';

	return (
		<div aria-live="polite" data-testid="build-status" className="absolute right-3 top-3 z-10">
			{status.kind === 'progress' && (
				<div role="progressbar" aria-label={status.label} aria-busy="true" className={pill}>
					<span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-600 border-t-indigo-400" />
					<span>{status.label}</span>
					{status.time && <span className="tabular-nums text-neutral-400">{status.time}</span>}
				</div>
			)}
			{status.kind === 'done' && (
				<div className={`${pill} text-emerald-300`}>
					<Check size={13} />
					<span>{status.label}</span>
				</div>
			)}
		</div>
	);
}
