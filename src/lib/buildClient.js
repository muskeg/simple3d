import { groupFromParts } from './csg.js';
import { getSvgPolygons } from './svg.js';

/** Settings as sent to the worker: SVGs carry pre-parsed polygons because workers lack DOMParser. */
function workerPayload(settings) {
	return { ...settings, objects: settings.objects.map((object) => (object.type === 'svg' && object.svg ? { ...object, svgPolygons: getSvgPolygons(object.svg) } : object)) };
}

/**
 * Builds models in a module worker, one at a time. A request made while
 * another is queued replaces it (the replaced promise resolves to null);
 * the in-flight build always completes. If the worker cannot start, builds
 * fall back to `fallback(settings)` on the page. `mode` reports which is used.
 */
export function createBuilder({ wasmURL, fontBase, fallback }) {
	let worker = null;
	let queued = null;
	let active = null;
	let nextId = 0;
	const state = { mode: 'starting' };
	let resolveReady;
	const started = new Promise((resolve) => { resolveReady = resolve; });

	const useFallback = () => {
		state.mode = 'main';
		worker?.terminate();
		worker = null;
		if (active) { queued ??= active; active = null; }
		resolveReady();
		pump();
	};

	function pump() {
		if (active || !queued || state.mode === 'starting') return;
		const job = queued;
		queued = null;
		if (state.mode === 'main') {
			try { job.resolve(fallback(job.settings)); } catch (error) { job.reject(error); }
			return pump();
		}
		active = { ...job, id: ++nextId };
		worker.postMessage({ type: 'build', id: active.id, settings: workerPayload(job.settings) });
	}

	try {
		worker = new Worker(new URL('./build.worker.js', import.meta.url), { type: 'module' });
		worker.onmessage = ({ data }) => {
			if (data.type === 'ready') { state.mode = 'worker'; resolveReady(); return pump(); }
			if (data.type === 'fatal') return useFallback();
			if (!active || data.id !== active.id) return;
			const job = active;
			active = null;
			if (data.type === 'result') job.resolve(groupFromParts(data.model));
			else job.reject(new Error(data.message));
			pump();
		};
		worker.onerror = (event) => { event.preventDefault?.(); useFallback(); };
		worker.postMessage({ type: 'init', wasmURL, fontBase });
	} catch {
		useFallback();
	}

	return {
		state,
		started,
		build(settings) {
			queued?.resolve(null);
			return new Promise((resolve, reject) => {
				queued = { settings, resolve, reject };
				pump();
			});
		},
		dispose() {
			worker?.terminate();
			worker = null;
			queued?.resolve(null);
			active?.resolve(null);
		},
	};
}
