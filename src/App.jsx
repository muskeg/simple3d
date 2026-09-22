import { useCallback, useEffect, useRef, useState } from 'react';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import Viewport from './components/Viewport.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import { buildModel, initGeometryEngine, withPrintLayout } from './lib/csg.js';
import manifoldWasmURL from 'manifold-3d/manifold.wasm?url';
import { export3MF, exportSTL, downloadBlob } from './lib/exporters.js';
import { rotationPresetForFace, facePositionPreset, facePlacementPreset } from './lib/placement.js';
import { preloadMaskImage } from './lib/mask.js';
import { validateSvg } from './lib/svg.js';
import { effectiveMode, objectBody } from './lib/objects.js';
import { lidOrigin, shellEnabled, shellWall } from './lib/bodies.js';
import { FONTS } from './lib/fonts.js';
import { parseProject, serializeProject, MAX_PROJECT_BYTES } from './lib/project.js';
import { PRESETS, presetSettings } from './lib/presets.js';

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
	hole: { text: '', holeDiameter: 5, head: 'none', headDiameter: 10, headDepth: 3 },
};

// Geometry keys that move faces, so face-snapped objects are re-snapped.
const RESNAP_KEYS = ['baseShape', 'sides', 'tubeWall', 'shell', 'wall', 'openTop', 'lid', 'lidThickness', 'lipDepth'];

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
};

export default function App() {
	const [settings, setSettings] = useState(DEFAULT_SETTINGS);
	const [font, setFont] = useState(null);
	const [fontError, setFontError] = useState(null);
	const [model, setModel] = useState(null);
	const [building, setBuilding] = useState(false);
	const [error, setError] = useState(null);
	const [exporting, setExporting] = useState(false);
	const [selectedId, setSelectedId] = useState(DEFAULT_SETTINGS.objects[0].id);
	const [builtSettings, setBuiltSettings] = useState(null);

	const modelRef = useRef(null); // live model group (for export)
	const timerRef = useRef(null);
	const savedRef = useRef(DEFAULT_SETTINGS); // last saved/loaded/preset state, for the unsaved-changes prompt
	const onModelRef = useCallback((group) => { modelRef.current = group; }, []);

	// Load the typeface font once.
	useEffect(() => {
		let cancelled = false;
		const loader = new FontLoader();
		Promise.all([initGeometryEngine(manifoldWasmURL), Promise.all(FONTS.map(async (entry) => [entry.id, await loader.loadAsync(`${import.meta.env.BASE_URL}fonts/${entry.file}`)]))])
			.then(([, entries]) => { if (!cancelled) setFont(Object.fromEntries(entries)); })
			.catch(() => { if (!cancelled) setFontError('Unable to load the geometry engine or fonts. Check your connection and reload.'); });
		return () => {
			cancelled = true;
		};
	}, []);

	// Rebuild the model whenever settings (or the font) change — debounced.
	useEffect(() => {
		if (!font) return;
		setBuilding(true);
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			try {
				const g = buildModel(settings, font);
				setModel(g);
				setBuiltSettings(settings);
				setError(g.children.length ? null : 'No solid remains. Reduce the cut depth or move an object.');
			} catch (e) {
				console.error('Model build failed', e);
				setError(e.message || String(e));
			} finally {
				setBuilding(false);
			}
		}, 180);
		return () => clearTimeout(timerRef.current);
	}, [settings, font]);

	const setNumber = useCallback(
		(key) => (v) => {
			setSettings((s) => {
				const next = { ...s, [key]: v };
				next.cornerRadius = Math.min(next.cornerRadius, Math.min(next.width, next.depth) / 2);
				next.chamfer = Math.min(next.chamfer, Math.min(next.width, next.depth, next.height) * 0.45);
				if (shellEnabled(next)) next.chamfer = Math.min(next.chamfer, shellWall(next) * 0.5);
				const resnap = RESNAP_KEYS.includes(key);
				if (resnap || ['width', 'height', 'depth'].includes(key)) {
					next.objects = s.objects.map((object) => {
						const target = object.target === 'lid' ? 'lid' : 'base';
						if (target === 'lid' && !objectBody(object, next)) return object;
						if (object.face !== 'auto' && (resnap || target === 'lid')) return { ...object, ...facePlacementPreset(object.face, next, target) };
						if (resnap) return object;
						const sx = next.width / s.width, sz = next.depth / s.depth;
						if (target === 'lid') return { ...object, pos: { x: object.pos.x * sx, y: object.pos.y + lidOrigin(next) - lidOrigin(s), z: object.pos.z * sz } };
						if (object.face === 'auto') return object;
						return { ...object, pos: { x: object.pos.x * sx, y: object.pos.y * next.height / s.height, z: object.pos.z * sz }, rot: facePlacementPreset(object.face, next).rot };
					});
				}
				return next;
			});
		},
		[],
	);
	const setMode = useCallback((mode) => setSettings((s) => ({ ...s, mode })), []);

	const updateObject = useCallback((id, patch) => {
		setSettings((s) => ({
			...s,
			objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
		}));
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

	const duplicateObject = useCallback((id) => {
		const src = settings.objects.find((object) => object.id === id);
		if (!src) return;
		const copy = { ...src, id: ++objectIdCounter, pos: { ...src.pos, x: src.pos.x + 6 } };
		setSettings((s) => ({ ...s, objects: [...s.objects, copy] }));
		setSelectedId(copy.id);
	}, [settings]);

	const removeObject = useCallback((id) => {
		setSettings((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== id) }));
		setSelectedId((sel) => (sel === id ? settings.objects.find((object) => object.id !== id)?.id ?? null : sel));
	}, [settings.objects]);

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
	}, []);

	const onSaveProject = useCallback(() => {
		downloadBlob(new Blob([serializeProject(settings)], { type: 'application/json' }), 'simple3d-project.json');
		savedRef.current = settings;
	}, [settings]);

	const onLoadProject = useCallback(async (file) => {
		if (file.size > MAX_PROJECT_BYTES) throw new Error('Project file is too large.');
		if (settings !== savedRef.current && !window.confirm('Discard unsaved changes and open this project?')) return;
		const { settings: next, maxId } = parseProject(await file.text(), DEFAULT_SETTINGS);
		for (const object of next.objects) {
			if (object.type === 'image') await preloadMaskImage(object.image);
			if (object.type === 'svg') validateSvg(object.svg);
		}
		objectIdCounter = Math.max(objectIdCounter, maxId);
		replaceSettings(next);
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

	return (
		<div className="flex h-full w-full flex-col md:flex-row bg-neutral-950 text-neutral-100">
			<ControlPanel
				settings={settings}
				setNumber={setNumber}
				setMode={setMode}
				updateObject={updateObject}
				addObject={addObject}
				addImageObject={addImageObject}
				setObjectImage={setObjectImage}
				addSvgObject={addSvgObject}
				setObjectSvg={setObjectSvg}
				setObjectTarget={setObjectTarget}
				duplicateObject={duplicateObject}
				removeObject={removeObject}
				snapToFace={snapToFace}
				selectedId={selectedId}
				setSelectedId={setSelectedId}
				onExport3MF={onExport3MF}
				onExportSTL={onExportSTL}
				onSaveProject={onSaveProject}
				onLoadProject={onLoadProject}
				onApplyPreset={onApplyPreset}
				building={building}
				exporting={exporting}
				error={error}
				warning={warning}
				fontError={fontError}
				ready={ready}
			/>
			<Viewport model={model} onModelRef={onModelRef} settings={settings} fonts={font} selectedId={selectedId} onSelect={setSelectedId} onUpdate={updateObject} />
		</div>
	);
}
