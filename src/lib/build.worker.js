import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { buildModel, disposeGroup, initGeometryEngine, partsFromGroup } from './csg.js';
import { preloadMaskImage } from './mask.js';
import { FONTS } from './fonts.js';

// Geometry builds run here so booleans never block pointer or typing on the page.
let ready;

async function loadFonts(base) {
	const loader = new FontLoader();
	const entries = await Promise.all(FONTS.map(async (entry) => {
		const response = await fetch(`${base}fonts/${entry.file}`);
		if (!response.ok) throw new Error(`Unable to load ${entry.label}.`);
		return [entry.id, loader.parse(await response.json())];
	}));
	return Object.fromEntries(entries);
}

self.onmessage = async ({ data }) => {
	if (data.type === 'init') {
		ready = Promise.all([initGeometryEngine(data.wasmURL), loadFonts(data.fontBase)]).then(([, fonts]) => fonts);
		ready.then(() => self.postMessage({ type: 'ready' }), (error) => self.postMessage({ type: 'fatal', message: error.message || String(error) }));
		return;
	}
	if (data.type !== 'build') return;
	const { id, settings } = data;
	let group;
	try {
		const fonts = await ready;
		for (const object of settings.objects || []) if (object.type === 'image' && object.image) await preloadMaskImage(object.image);
		group = buildModel(settings, fonts);
		const model = partsFromGroup(group);
		self.postMessage({ type: 'result', id, model }, model.parts.flatMap((part) => [part.positions.buffer, part.indices.buffer]));
	} catch (error) {
		self.postMessage({ type: 'error', id, message: error.message || String(error) });
	} finally {
		disposeGroup(group);
	}
};
