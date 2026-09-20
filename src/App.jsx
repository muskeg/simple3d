import { useCallback, useEffect, useRef, useState } from 'react';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import Viewport from './components/Viewport.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import { buildModel, initGeometryEngine } from './lib/csg.js';
import manifoldWasmURL from 'manifold-3d/manifold.wasm?url';
import { export3MF, exportSTL, downloadBlob } from './lib/exporters.js';
import { rotationPresetForFace, facePositionPreset, facePlacementPreset } from './lib/placement.js';
import { preloadMaskImage } from './lib/mask.js';
import { FONTS } from './lib/fonts.js';

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
		pos: facePositionPreset('top', { width: 100, depth: 60, height: 12 }),
		rot: preset.rot,
		face: 'top',
		...overrides,
	};
}

const DEFAULT_SETTINGS = {
	// Base plate
	baseShape: 'box', // box | cylinder | sphere | cone | pyramid
	width: 100,
	depth: 60,
	height: 12,
	cornerRadius: 10,
	chamfer: 2.5,
	chamferSegments: 1, // 1 = straight chamfer, >1 = round fillet
	radialSegments: 64, // tessellation for cylinder/sphere/cone
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
				if (['width', 'height', 'depth', 'baseShape'].includes(key)) {
					next.objects = s.objects.map((object) => {
						if (object.face === 'auto') return object;
						if (key === 'baseShape') return { ...object, ...facePlacementPreset(object.face, next) };
						return { ...object, pos: { x: object.pos.x * next.width / s.width, y: object.pos.y * next.height / s.height, z: object.pos.z * next.depth / s.depth }, rot: facePlacementPreset(object.face, next).rot };
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
			const obj = makeObject({ type, font: settings.font, ...facePlacementPreset('top', settings) });
			setSettings((s) => ({ ...s, objects: [...s.objects, obj] }));
			setSelectedId(obj.id);
		},
		[settings],
	);

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
							...facePlacementPreset(face, s),
						}
					: o,
			),
		}));
	}, []);

	const ready = !!model && builtSettings === settings && !building && !error && !fontError;
	const onExport3MF = useCallback(async () => {
		if (!modelRef.current || exporting || !ready) return;
		setExporting(true);
		try {
			const blob = await export3MF(modelRef.current);
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
			const ab = exportSTL(modelRef.current);
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
				duplicateObject={duplicateObject}
				removeObject={removeObject}
				snapToFace={snapToFace}
				selectedId={selectedId}
				setSelectedId={setSelectedId}
				onExport3MF={onExport3MF}
				onExportSTL={onExportSTL}
				building={building}
				exporting={exporting}
				error={error}
				fontError={fontError}
				ready={ready}
			/>
			<Viewport model={model} onModelRef={onModelRef} settings={settings} fonts={font} selectedId={selectedId} onSelect={setSelectedId} onUpdate={updateObject} />
		</div>
	);
}
