export const SHOW_AFTER_MS = 250;
export const ELAPSED_AFTER_MS = 1000;

/**
 * What the viewport status pill shows. `elapsed` is how long work has been
 * running (ms); `done` is the duration of the last slow build, or null.
 * Start-up and file processing show immediately; builds after SHOW_AFTER_MS.
 */
export function describeStatus({ initializing, activity, building, elapsed, done }) {
	const active = initializing || !!activity || building;
	if (active) {
		const label = initializing ? 'Loading geometry engine…' : activity || 'Updating model…';
		const visible = initializing || !!activity || elapsed >= SHOW_AFTER_MS;
		return { kind: visible ? 'progress' : 'hidden', label, time: elapsed >= ELAPSED_AFTER_MS ? `${(elapsed / 1000).toFixed(1)} s` : null };
	}
	return done !== null && done > ELAPSED_AFTER_MS ? { kind: 'done', label: `Updated in ${(done / 1000).toFixed(1)} s`, time: null } : { kind: 'hidden', label: null, time: null };
}
