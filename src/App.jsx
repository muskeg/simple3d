import { useCallback, useEffect, useRef, useState } from 'react';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import Viewport from './components/Viewport.jsx';
import ScenePanel from './components/ScenePanel.jsx';
import Inspector from './components/Inspector.jsx';
import { useMediaQuery, usePersistentState } from './components/ui.jsx';
import { buildModel, disposeGroup, initGeometryEngine, withPrintLayout } from './lib/csg.js';
import { createBuilder } from './lib/buildClient.js';
import manifoldWasmURL from 'manifold-3d/manifold.wasm?url';
import { export3MF, exportSTL, downloadBlob } from './lib/exporters.js';
import { rotationPresetForFace, facePositionPreset, facePlacementPreset } from './lib/placement.js';
import { preloadMaskImage } from './lib/mask.js';
import { validateSvg } from './lib/svg.js';
import { effectiveMode, objectBody } from './lib/objects.js';
import { shellEnabled, shellWall } from './lib/bodies.js';
import { applyBaseChange } from './lib/baseSettings.js';
import { loadMeshFile, MAX_MESH_BYTES, DENSE_MESH_TRIANGLES } from './lib/meshImport.js';
import { decodeMesh, rotateMesh } from './lib/meshData.js';
import { FONTS, MAX_FONT_BYTES, bufferToBase64, parseFontData } from './lib/fonts.js';
import { parseProject, serializeProject, MAX_PROJECT_BYTES } from './lib/project.js';
import { PRESETS, presetSettings } from './lib/presets.js';
import { alignObjects, bodyCenter, centerOnFace, distributeObjects, nudgeObjects } from './lib/align.js';
import { arrayInstances } from './lib/arrays.js';

const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const DEFAULT_PREFS = { gridSnap: false, gridStep: 1, angleStep: 15 };
const HISTORY_LIMIT = 100;
const HISTORY_COALESCE_MS = 400;
const BUILD_DEBOUNCE_MS = 120;
const AUTOSAVE_KEY = 'simple3d.autosave';
const AUTOSAVE_DELAY_MS = 1000;

let objectIdCounter = 0;
function makeObject(overrides = {}) {
	const id = ++objectIdCounter;
	const preset = rotationPresetForFace('top');
	return {
		id,
		type: 'text',
		text: 'ABC',
		fontSize: 16,
		curveSegments: 8,
		extrudeHeight: 4,
		inlayDepth: 2,
		mode: 'inherit',
		target: 'base',
		mirror: false,
		pos: facePositionPreset('top', { width: 100, depth: 60, height: 12 }),
		rot: preset.rot,
		face: 'top',
		...overrides,
	};
}

const OBJECT_DEFAULTS = {
	text: {},
	shape: { shape: 'star', text: '', fontSize: 24, shapeHeight: 24, sides: 5, innerRatio: 0.5, cornerRadius: 0 },
	hole: { text: '', holeDiameter: 5, head: 'none', headDiameter: 10, headDepth: 3, holeDepthMode: 'through', holeDepth: 3 },
};

const DEFAULT_SETTINGS = {
	// Base plate
	baseShape: 'box', // see BASE_SHAPES
	width: 100,
	depth: 60,
	height: 12,
	cornerRadius: 10,
	chamfer: 2.5,
	chamferSegments: 1, // 1 = straight chamfer, >1 = round fillet
	radialSegments: 64, // tessellation for cylinder/sphere/cone
	sides: 6,
	tubeWall: 3,
	customMesh: null, // imported base mesh record (see lib/meshData.js)
	meshLock: true, // custom mesh keeps proportions when one dimension changes
	// Hollow shell + lid (box, cylinder, n-gon)
	shell: false,
	wall: 2,
	openTop: true,
	lid: false,
	lidThickness: 2,
	lipDepth: 4,
	lidClearance: 0.2,
	// Objects (text / image masks)
	objects: [makeObject()],
	// Mode: 'raised' | 'inset' | 'flush_inlay'
	mode: 'raised',
	insetDepth: 2,
	// Font
	font: 'helvetiker',
	customFonts: [], // uploaded TTF/OTF: { id: 'custom-N', label, data: base64 }
};

const freshSettings = () => ({ ...DEFAULT_SETTINGS, objects: [makeObject()] });

/** Which fields changed between two settings snapshots, e.g. "width" or "3:pos,face". */
function changeSignature(before, after) {
	const keys = Object.keys({ ...before, ...after }).filter((key) => key !== 'objects' && before[key] !== after[key]);
	if (before.objects !== after.objects) {
		const same = before.objects.length === after.objects.length && before.objects.every((object, index) => object.id === after.objects[index].id);
		if (!same) keys.push('objects');
		else after.objects.forEach((object, index) => {
			const old = before.objects[index];
			if (old !== object) keys.push(`${object.id}:${Object.keys({ ...old, ...object }).filter((key) => old[key] !== object[key]).sort().join(',')}`);
		});
	}
	return keys.sort().join('|');
}

/** Validates project JSON and decodes its images/SVGs/fonts, so a build can start immediately. */
async function loadProjectText(text) {
	const { settings, maxId } = parseProject(text, DEFAULT_SETTINGS);
	for (const object of settings.objects) {
		if (object.type === 'image') await preloadMaskImage(object.image);
		if (object.type === 'svg') validateSvg(object.svg);
		if (object.type === 'mesh') decodeMesh(object.mesh);
	}
	if (settings.customMesh) decodeMesh(settings.customMesh);
	for (const entry of settings.customFonts || []) parseFontData(entry.data);
	objectIdCounter = Math.max(objectIdCounter, maxId);
	return settings;
}

async function restoreAutosave() {
	try {
		const text = localStorage.getItem(AUTOSAVE_KEY);
		return text ? await loadProjectText(text) : null;
	} catch {
		return null;
	}
}

export default function App() {
	const [settings, setSettings] = useState(DEFAULT_SETTINGS);
	const [font, setFont] = useState(null);
	const [fontError, setFontError] = useState(null);
	const [model, setModel] = useState(null);
	const [building, setBuilding] = useState(false);
	const [error, setError] = useState(null);
	const [exporting, setExporting] = useState(false);
	// Selected object ids; the last one is the primary (inspected, gizmo-attached) object.
	const [selection, setSelection] = useState([DEFAULT_SETTINGS.objects[0].id]);
	const [builtSettings, setBuiltSettings] = useState(null);
	const [prefs, setPrefs] = usePersistentState('simple3d.prefs', DEFAULT_PREFS);
	const isDesktop = useMediaQuery('(min-width: 768px)');
	const selectedId = selection.at(-1) ?? null;
	const setSelectedId = useCallback((id) => setSelection(id == null ? [] : [id]), []);

	const modelRef = useRef(null); // live model group (for export)
	const savedRef = useRef(DEFAULT_SETTINGS); // last saved/loaded/preset state, for the unsaved-changes prompt
	const onModelRef = useCallback((group) => { modelRef.current = group; }, []);
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const fontsRef = useRef(font);
	fontsRef.current = font;
	const builderRef = useRef(null);
	const autosaveReady = useRef(false);
	const [notice, setNotice] = useState(null);
	// Label of page-side processing (imports, project loading) shown by the viewport status pill.
	const [activity, setActivity] = useState(null);
	const runTask = useCallback(async (label, task) => {
		setActivity(label);
		// Let the indicator paint before synchronous work (mesh validation) blocks the page.
		await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
		try { return await task(); } finally { setActivity(null); }
	}, []);

	// Undo history of settings snapshots; bursts of edits to the same fields (typing, scrubbing, dragging) coalesce into one step.
	const historyRef = useRef({ past: [], future: [], committed: DEFAULT_SETTINGS, timer: 0, seen: DEFAULT_SETTINGS, signature: null });
	const [, setHistoryVersion] = useState(0);
	const pushHistory = useCallback((snapshot) => {
		const history = historyRef.current;
		if (snapshot === history.committed) return;
		history.past.push(history.committed);
		if (history.past.length > HISTORY_LIMIT) history.past.shift();
		history.future = [];
		history.committed = snapshot;
		setHistoryVersion((version) => version + 1);
	}, []);
	const commitHistory = useCallback(() => {
		clearTimeout(historyRef.current.timer);
		historyRef.current.signature = null;
		pushHistory(settingsRef.current);
	}, [pushHistory]);
	// Scrubs, drags and gizmo moves stay one step however slowly they run.
	const pointerDown = useRef(false);
	const commitWhenIdle = useCallback(() => {
		if (pointerDown.current) historyRef.current.timer = setTimeout(commitWhenIdle, HISTORY_COALESCE_MS);
		else commitHistory();
	}, [commitHistory]);
	useEffect(() => {
		const down = () => { pointerDown.current = true; };
		const up = () => { pointerDown.current = false; };
		window.addEventListener('pointerdown', down, true);
		window.addEventListener('pointerup', up, true);
		window.addEventListener('pointercancel', up, true);
		return () => {
			window.removeEventListener('pointerdown', down, true);
			window.removeEventListener('pointerup', up, true);
			window.removeEventListener('pointercancel', up, true);
		};
	}, []);
	useEffect(() => {
		const history = historyRef.current;
		const previous = history.seen;
		history.seen = settings;
		if (settings === history.committed) return;
		const signature = changeSignature(previous, settings);
		if (history.signature !== null && signature !== history.signature) pushHistory(previous);
		history.signature = signature;
		clearTimeout(history.timer);
		history.timer = setTimeout(commitWhenIdle, HISTORY_COALESCE_MS);
	}, [settings, commitWhenIdle, pushHistory]);
	const restoreSnapshot = useCallback((target) => {
		historyRef.current.committed = target;
		historyRef.current.signature = null;
		setSettings(target);
		const ids = new Set(target.objects.map((object) => object.id));
		setSelection((current) => current.filter((id) => ids.has(id)));
		setHistoryVersion((version) => version + 1);
	}, []);
	const undo = useCallback(() => {
		commitHistory();
		const history = historyRef.current;
		if (!history.past.length) return;
		history.future.push(history.committed);
		restoreSnapshot(history.past.pop());
	}, [commitHistory, restoreSnapshot]);
	const redo = useCallback(() => {
		commitHistory();
		const history = historyRef.current;
		if (!history.future.length) return;
		history.past.push(history.committed);
		restoreSnapshot(history.future.pop());
	}, [commitHistory, restoreSnapshot]);
	const canUndo = historyRef.current.past.length > 0 || settings !== historyRef.current.committed;
	const canRedo = historyRef.current.future.length > 0 && settings === historyRef.current.committed;

	useEffect(() => {
		const builder = createBuilder({ wasmURL: manifoldWasmURL, fontBase: import.meta.env.BASE_URL, fallback: (s) => buildModel(s, fontsRef.current) });
		builderRef.current = builder;
		builder.started.then(() => { document.documentElement.dataset.buildMode = builder.state.mode; });
		return () => builder.dispose();
	}, []);

	// Load the engine and fonts once, restoring the autosaved design before the first build.
	useEffect(() => {
		let cancelled = false;
		const loader = new FontLoader();
		Promise.all([initGeometryEngine(manifoldWasmURL), Promise.all(FONTS.map(async (entry) => [entry.id, await loader.loadAsync(`${import.meta.env.BASE_URL}fonts/${entry.file}`)]))])
			.then(async ([, entries]) => {
				const restored = await restoreAutosave();
				if (cancelled) return;
				if (restored) {
					historyRef.current = { past: [], future: [], committed: restored, timer: 0, seen: restored, signature: null };
					setSettings(restored);
					setSelection(restored.objects[0] ? [restored.objects[0].id] : []);
					setNotice('Restored your previous session.');
				}
				autosaveReady.current = true;
				setFont(Object.fromEntries(entries));
			})
			.catch(() => { if (!cancelled) setFontError('Unable to load the geometry engine or fonts. Check your connection and reload.'); });
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!autosaveReady.current) return undefined;
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(AUTOSAVE_KEY, serializeProject(settings));
			} catch {
				setNotice('Autosave paused: this design is too large for browser storage. Use File > Save project.');
			}
		}, AUTOSAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [settings]);

	// Rebuild in the worker whenever settings (or the fonts) change; stale results are discarded.
	useEffect(() => {
		if (!font) return undefined;
		setBuilding(true);
		const timer = setTimeout(() => {
			const requested = settings;
			builderRef.current.build(requested).then((group) => {
				if (!group) return;
				if (settingsRef.current !== requested) { disposeGroup(group); return; }
				setModel(group);
				setBuiltSettings(requested);
				setError(group.children.length ? null : 'No solid remains. Reduce the cut depth or move an object.');
				setBuilding(false);
			}, (e) => {
				if (settingsRef.current !== requested) return;
				console.error('Model build failed', e);
				setError(e.message || String(e));
				setBuilding(false);
			});
		}, BUILD_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [settings, font]);

	const setNumber = useCallback((key) => (v) => setSettings((s) => applyBaseChange(s, { [key]: v })), []);
	const setBase = useCallback((patch) => setSettings((s) => applyBaseChange(s, patch)), []);
	const setMode = useCallback((mode) => setSettings((s) => ({ ...s, mode })), []);

	const readMesh = (file) => runTask('Importing mesh…', async () => {
		if (file.size > MAX_MESH_BYTES) throw new Error('Mesh file exceeds the 25 MB limit.');
		const record = loadMeshFile(file.name, await file.arrayBuffer());
		if (record.triangleCount > DENSE_MESH_TRIANGLES) setNotice(`${record.name} has ${record.triangleCount.toLocaleString('en-US')} triangles; rebuilds will be slow.`);
		return record;
	});

	const importBaseMesh = useCallback(async (file) => {
		const record = await readMesh(file);
		setBase({ baseShape: 'custom', customMesh: record, width: record.size.x, height: record.size.y, depth: record.size.z });
	}, [setBase]);

	const rotateBaseMesh = useCallback((axis) => {
		const record = rotateMesh(settings.customMesh, axis);
		const { width: w, height: h, depth: d } = settings;
		const dims = axis === 'x' ? { width: w, height: d, depth: h } : axis === 'y' ? { width: d, height: h, depth: w } : { width: h, height: w, depth: d };
		setBase({ customMesh: record, ...dims });
	}, [settings, setBase]);

	const resetBaseMeshSize = useCallback(() => {
		const { size } = settings.customMesh;
		setBase({ width: size.x, height: size.y, depth: size.z });
	}, [settings.customMesh, setBase]);

	const updateObject = useCallback((id, patch) => {
		setSettings((s) => ({
			...s,
			objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
		}));
	}, []);

	const updateObjects = useCallback((patches) => {
		if (!Object.keys(patches).length) return;
		setSettings((s) => ({ ...s, objects: s.objects.map((o) => (patches[o.id] ? { ...o, ...patches[o.id] } : o)) }));
	}, []);

	const selectObject = useCallback((id, additive = false) => {
		if (id == null) return setSelection([]);
		if (!additive) return setSelection([id]);
		setSelection((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
	}, []);

	const addObject = useCallback(
		(type = 'text') => {
			const obj = makeObject({ type, font: settings.font, ...OBJECT_DEFAULTS[type], ...facePlacementPreset('top', settings) });
			setSettings((s) => ({ ...s, objects: [...s.objects, obj] }));
			setSelectedId(obj.id);
		},
		[settings],
	);

	const addSvgObject = useCallback((svg) => {
		validateSvg(svg);
		const obj = makeObject({ type: 'svg', svg, text: 'SVG', fontSize: 40, ...facePlacementPreset('top', settings) });
		setSettings((s) => ({ ...s, objects: [...s.objects, obj] }));
		setSelectedId(obj.id);
	}, [settings]);

	const setObjectSvg = useCallback((id, svg) => {
		validateSvg(svg);
		setSettings((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, svg } : o)) }));
	}, []);

	const setObjectTarget = useCallback((id, target) => {
		setSettings((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, target, ...facePlacementPreset('top', s, target) } : o)) }));
	}, []);

	const addImageObject = useCallback(async (dataURL) => {
		await preloadMaskImage(dataURL);
		const obj = makeObject({ type: 'image', image: dataURL, text: 'Image', fontSize: 40, threshold: 128, maskResolution: 256, maskChannel: 'alpha', ...facePlacementPreset('top', settings) });
		setSettings((s) => ({ ...s, objects: [...s.objects, obj] }));
		setSelectedId(obj.id);
	}, [settings]);

	const setObjectImage = useCallback(async (id, dataURL) => {
		await preloadMaskImage(dataURL);
		updateObject(id, { image: dataURL });
	}, [updateObject]);

	const addMeshObject = useCallback(async (file) => {
		const record = await readMesh(file);
		const obj = makeObject({ type: 'mesh', mesh: record, text: '', fontSize: Number(record.size.x.toFixed(3)), ...facePlacementPreset('top', settingsRef.current) });
		setSettings((s) => ({ ...s, objects: [...s.objects, obj] }));
		setSelectedId(obj.id);
	}, [setSelectedId]);

	const setObjectMesh = useCallback(async (id, file) => {
		const record = await readMesh(file);
		updateObject(id, { mesh: record, fontSize: Number(record.size.x.toFixed(3)) });
	}, [updateObject]);

	const duplicateObjects = useCallback((ids) => {
		const copies = ids.map((id) => settings.objects.find((object) => object.id === id)).filter(Boolean)
			.map((src) => ({ ...src, id: ++objectIdCounter, pos: { ...src.pos, x: src.pos.x + 6 }, face: 'auto' }));
		if (!copies.length) return;
		setSettings((s) => ({ ...s, objects: [...s.objects, ...copies] }));
		setSelection(copies.map((copy) => copy.id));
	}, [settings]);

	const removeObjects = useCallback((ids) => {
		setSettings((s) => ({ ...s, objects: s.objects.filter((o) => !ids.includes(o.id)) }));
		setSelection((current) => {
			const remaining = current.filter((id) => !ids.includes(id));
			if (remaining.length || !current.some((id) => ids.includes(id))) return remaining;
			const fallback = settings.objects.find((object) => !ids.includes(object.id));
			return fallback ? [fallback.id] : [];
		});
	}, [settings.objects]);

	// Viewport drags move the whole selection by the primary object's translation; rotation stays per object.
	const onViewportUpdate = useCallback((id, patch) => {
		setSettings((s) => {
			const source = s.objects.find((object) => object.id === id);
			if (!source) return s;
			const group = selection.includes(id) ? selection : [id];
			const delta = patch.pos ? ['x', 'y', 'z'].map((axis) => patch.pos[axis] - source.pos[axis]) : [0, 0, 0];
			return {
				...s,
				objects: s.objects.map((o) => {
					if (o.id === id) return { ...o, ...patch };
					if (!group.includes(o.id)) return o;
					return { ...o, pos: { x: o.pos.x + delta[0], y: o.pos.y + delta[1], z: o.pos.z + delta[2] }, face: 'auto' };
				}),
			};
		});
	}, [selection]);

	const onAlign = useCallback((ids, axis, edge) => {
		updateObjects(alignObjects(settings.objects.filter((o) => ids.includes(o.id)), axis, edge, font, settings));
	}, [settings, font, updateObjects]);
	const onDistribute = useCallback((ids, axis) => {
		updateObjects(distributeObjects(settings.objects.filter((o) => ids.includes(o.id)), axis, font, settings));
	}, [settings, font, updateObjects]);
	const onCenterOnFace = useCallback((id, directions) => {
		const object = settings.objects.find((o) => o.id === id);
		if (object) updateObject(id, centerOnFace(object, settings, directions));
	}, [settings, updateObject]);
	const onCenterOnBody = useCallback((id, axis) => {
		const object = settings.objects.find((o) => o.id === id);
		if (object) updateObject(id, { pos: { ...object.pos, [axis]: bodyCenter(settings, objectBody(object, settings) || 'base')[axis] }, face: 'auto' });
	}, [settings, updateObject]);

	const addCustomFont = useCallback(async (file, objectId) => {
		if (file.size > MAX_FONT_BYTES) throw new Error('Font exceeds the 10 MB limit.');
		const data = await runTask('Reading font…', async () => {
			const encoded = bufferToBase64(await file.arrayBuffer());
			parseFontData(encoded);
			return encoded;
		});
		const fonts = settings.customFonts || [];
		const existing = fonts.find((entry) => entry.data === data);
		if (!existing && fonts.length >= 8) throw new Error('Projects are limited to 8 uploaded fonts.');
		const id = existing?.id ?? `custom-${Math.max(0, ...fonts.map((entry) => Number(entry.id.slice(7)))) + 1}`;
		const label = file.name.replace(/\.(ttf|otf)$/i, '').slice(0, 64) || 'Uploaded font';
		setSettings((s) => ({
			...s,
			customFonts: existing ? s.customFonts : [...(s.customFonts || []), { id, label, data }],
			objects: s.objects.map((o) => (o.id === objectId ? { ...o, font: id } : o)),
		}));
	}, [settings.customFonts]);

	const explodeArray = useCallback((id) => {
		const source = settings.objects.find((object) => object.id === id);
		if (!source) return;
		const original = { ...source, arrayKind: 'none' };
		const copies = arrayInstances(source).slice(1).map((placement) => ({ ...original, ...placement, id: ++objectIdCounter, face: 'auto' }));
		setSettings((s) => ({ ...s, objects: s.objects.flatMap((object) => (object.id === id ? [original, ...copies] : [object])) }));
		setSelection([...copies.map((copy) => copy.id), id]);
	}, [settings]);

	const latest = useRef(null);
	latest.current = { settings, selection, removeObjects, duplicateObjects, updateObjects, undo, redo };
	useEffect(() => {
		const onKey = (event) => {
			if (event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="menu"]') || document.querySelector('[role="menu"]')) return;
			const { settings: s, selection: ids, removeObjects: remove, duplicateObjects: duplicate, updateObjects: update } = latest.current;
			const modifier = event.ctrlKey || event.metaKey;
			const key = event.key.toLowerCase();
			if (modifier && (key === 'z' || key === 'y')) {
				event.preventDefault();
				return key === 'y' || event.shiftKey ? latest.current.redo() : latest.current.undo();
			}
			if (event.key === 'Escape') return setSelection([]);
			if (!ids.length) return;
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				remove(ids);
			} else if (modifier && event.key.toLowerCase() === 'd') {
				event.preventDefault();
				duplicate(ids);
			} else if (ARROWS[event.key] && !modifier) {
				const objects = s.objects.filter((o) => ids.includes(o.id));
				const primary = objects.find((o) => o.id === ids.at(-1));
				if (!primary) return;
				event.preventDefault();
				update(nudgeObjects(objects, primary, ARROWS[event.key], event.shiftKey ? 10 : event.altKey ? 0.1 : 1));
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const snapToFace = useCallback((id, face) => {
		setSettings((s) => ({
			...s,
			objects: s.objects.map((o) =>
				o.id === id
					? {
							...o,
							...facePlacementPreset(face, s, objectBody(o, s) || 'base'),
						}
					: o,
			),
		}));
	}, []);

	const replaceSettings = useCallback((next) => {
		savedRef.current = next;
		setSettings(next);
		setSelectedId(next.objects[0]?.id ?? null);
	}, [setSelectedId]);

	const onNewProject = useCallback(() => {
		if (settings !== savedRef.current && !window.confirm('Discard unsaved changes and start a new project?')) return;
		replaceSettings(freshSettings());
	}, [settings, replaceSettings]);

	const onSaveProject = useCallback(() => {
		downloadBlob(new Blob([serializeProject(settings)], { type: 'application/json' }), 'simple3d-project.json');
		savedRef.current = settings;
	}, [settings]);

	const onLoadProject = useCallback(async (file) => {
		if (file.size > MAX_PROJECT_BYTES) throw new Error('Project file is too large.');
		if (settings !== savedRef.current && !window.confirm('Discard unsaved changes and open this project?')) return;
		replaceSettings(await runTask('Opening project…', async () => loadProjectText(await file.text())));
	}, [settings, replaceSettings]);

	const onApplyPreset = useCallback((id) => {
		const preset = PRESETS.find((entry) => entry.id === id);
		if (!preset) return;
		if (settings !== savedRef.current && !window.confirm(`Replace the current design with the ${preset.label} preset?`)) return;
		replaceSettings(presetSettings(id, DEFAULT_SETTINGS, (fields) => makeObject({ ...OBJECT_DEFAULTS[fields.type || 'text'], ...fields })));
	}, [settings, replaceSettings]);

	const warning = shellEnabled(settings) && settings.objects.some((o) => {
		const mode = effectiveMode(o, settings);
		const depth = mode === 'inset' ? o.insetDepth ?? settings.insetDepth : mode === 'flush_inlay' ? o.inlayDepth ?? 2 : 0;
		return objectBody(o, settings) === 'base' && depth >= shellWall(settings);
	}) ? 'An inset or inlay is as deep as the shell wall and may break through.' : null;

	const ready = !!model && builtSettings === settings && !building && !error && !fontError;
	const onExport3MF = useCallback(async () => {
		if (!modelRef.current || exporting || !ready) return;
		setExporting(true);
		try {
			// export3MF serializes synchronously before its first await, so the layout is restored safely.
			const blob = await withPrintLayout(modelRef.current, () => export3MF(modelRef.current));
			downloadBlob(blob, 'simple3d-model.3mf');
		} catch (e) {
			console.error(e);
			setError(`3MF export failed: ${e.message}`);
		} finally {
			setExporting(false);
		}
	}, [exporting, ready]);

	const onExportSTL = useCallback(() => {
		if (!modelRef.current || !ready) return;
		try {
			const ab = withPrintLayout(modelRef.current, () => exportSTL(modelRef.current));
			downloadBlob(new Blob([ab], { type: 'model/stl' }), 'simple3d-model.stl');
		} catch (e) {
			console.error(e);
			setError(`STL export failed: ${e.message}`);
		}
	}, [ready]);

	const inspector = (
		<Inspector
			settings={settings}
			selection={selection}
			updateObject={updateObject}
			duplicateObjects={duplicateObjects}
			removeObjects={removeObjects}
			snapToFace={snapToFace}
			setObjectTarget={setObjectTarget}
			setObjectImage={setObjectImage}
			setObjectSvg={setObjectSvg}
			setObjectMesh={setObjectMesh}
			addCustomFont={addCustomFont}
			onAlign={onAlign}
			onDistribute={onDistribute}
			onCenterOnFace={onCenterOnFace}
			onCenterOnBody={onCenterOnBody}
			explodeArray={explodeArray}
			prefs={prefs}
			setPrefs={setPrefs}
			className={isDesktop ? 'min-h-full' : ''}
		/>
	);

	return (
		<div className="flex h-full w-full flex-col md:flex-row bg-neutral-950 text-neutral-100">
			<ScenePanel
				settings={settings}
				setNumber={setNumber}
				setMode={setMode}
				selection={selection}
				onSelect={selectObject}
				addObject={addObject}
				addImageObject={addImageObject}
				addSvgObject={addSvgObject}
				addMeshObject={addMeshObject}
				importBaseMesh={importBaseMesh}
				rotateBaseMesh={rotateBaseMesh}
				resetBaseMeshSize={resetBaseMeshSize}
				duplicateObjects={duplicateObjects}
				removeObjects={removeObjects}
				onNewProject={onNewProject}
				onSaveProject={onSaveProject}
				onLoadProject={onLoadProject}
				onApplyPreset={onApplyPreset}
				onExport3MF={onExport3MF}
				onExportSTL={onExportSTL}
				exporting={exporting}
				error={error}
				warning={warning}
				fontError={fontError}
				ready={ready}
				inspector={isDesktop ? null : inspector}
				undo={undo}
				redo={redo}
				canUndo={canUndo}
				canRedo={canRedo}
				notice={notice}
				onDismissNotice={() => setNotice(null)}
			/>
			<Viewport model={model} onModelRef={onModelRef} settings={settings} fonts={font} selection={selection} onSelect={selectObject} onUpdate={onViewportUpdate} prefs={prefs} onToggleGridSnap={() => setPrefs({ ...prefs, gridSnap: !prefs.gridSnap })} status={{ building, activity, initializing: !font && !fontError }} />
			{isDesktop && <aside aria-label="Inspector" className="panel-scroll w-[300px] shrink-0 overflow-y-auto border-l border-white/10 bg-neutral-900">{inspector}</aside>}
		</div>
	);
}
