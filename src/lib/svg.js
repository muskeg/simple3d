import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { getEngine, solidToGeometry, withTracking, Z_TO_Y_ARRAY } from './engine.js';

/**
 * SVG outline pipeline. Filled paths are flattened, unioned in 2D (so
 * overlapping paths never produce self-intersecting solids) and extruded
 * into the same unit prism as text: width = fontSize mm, SVG top -> -Z.
 *
 * The SVG is only parsed as XML by SVGLoader; it is never inserted into the DOM.
 * Cached geometry is borrowed; callers clone it before mutation/disposal.
 */
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
const cache = new Map();
const MAX_CACHE = 16;

function svgContours(text) {
	const data = new SVGLoader().parse(text);
	const shapes = [];
	for (const path of data.paths) {
		if (path.userData?.style?.fill === 'none') continue;
		for (const shape of SVGLoader.createShapes(path)) {
			const { shape: outer, holes } = shape.extractPoints(12);
			if (outer.length < 3) continue;
			shapes.push([outer, ...holes].filter((ring) => ring.length >= 3).map((ring) => ring.map((point) => [point.x, -point.y])));
		}
	}
	return shapes;
}

/** Throws a user-facing error unless the text is an SVG with at least one filled shape. */
export function validateSvg(text) {
	if (typeof text !== 'string' || text.length > MAX_SVG_BYTES) throw new Error('SVG exceeds the 2 MB limit.');
	let shapes;
	try { shapes = svgContours(text); } catch { throw new Error('Unable to parse SVG.'); }
	if (!shapes.length) throw new Error('SVG contains no filled shapes.');
}

/** Returns a (possibly cached) unit-prism geometry for an SVG object, or null. */
export function getSvgGeometry(object) {
	if (!object.svg) return null;
	const key = `${object.fontSize ?? 40}|${object.svg}`;
	if (!cache.has(key)) {
		cache.set(key, buildSvgGeometry(object.svg, Math.max(0.1, object.fontSize ?? 40)));
		if (cache.size > MAX_CACHE) {
			const oldest = cache.keys().next().value;
			cache.get(oldest)?.dispose();
			cache.delete(oldest);
		}
	}
	return cache.get(key);
}

function buildSvgGeometry(text, width) {
	const { CrossSection } = getEngine();
	let shapes;
	try { shapes = svgContours(text); } catch { return null; }
	if (!shapes.length) return null;
	return withTracking((track) => {
		const sections = shapes.map((rings) => track(new CrossSection(rings, 'EvenOdd')));
		const merged = track(CrossSection.union(sections));
		if (merged.isEmpty()) return null;
		const bounds = merged.bounds();
		const spanX = bounds.max[0] - bounds.min[0];
		if (!(spanX > 0)) return null;
		const scale = width / spanX;
		const centered = track(track(merged.translate([-(bounds.min[0] + bounds.max[0]) / 2, -(bounds.min[1] + bounds.max[1]) / 2])).scale(scale));
		const solid = track(track(track(centered.extrude(1)).transform(Z_TO_Y_ARRAY)).translate([0, -0.5, 0]));
		return solidToGeometry(solid);
	});
}
