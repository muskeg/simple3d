import { createTextGeometry } from './geometry.js';
import { getMaskGeometry } from './mask.js';
import { getSvgGeometry } from './svg.js';
import { createShapeGeometry } from './shapes2d.js';
import { objectFont } from './fonts.js';
import { lidEnabled } from './bodies.js';
import { getEngine, solidToGeometry, withTracking, Z_TO_Y_ARRAY } from './engine.js';

export const OBJECT_MODES = [
	{ id: 'inherit', label: 'Default' },
	{ id: 'raised', label: 'Raised' },
	{ id: 'inset', label: 'Inset' },
	{ id: 'flush_inlay', label: 'Flush inlay' },
];

export const HOLE_HEADS = [
	{ id: 'none', label: 'Plain' },
	{ id: 'countersink', label: 'Countersunk' },
	{ id: 'counterbore', label: 'Counterbored' },
];

export function effectiveMode(object, settings) {
	if (object.type === 'hole') return 'hole';
	return object.mode && object.mode !== 'inherit' ? object.mode : settings.mode;
}

/** Body an object belongs to, or null when it targets a disabled lid. */
export function objectBody(object, settings) {
	if (object.target !== 'lid') return 'base';
	return lidEnabled(settings) ? 'lid' : null;
}

export function objectLabel(object) {
	if (object.type === 'text') return object.text?.split('\n').find((line) => line.trim()) || 'empty text';
	if (object.type === 'hole') return `Hole ⌀${object.holeDiameter ?? 5}`;
	if (object.type === 'shape') return object.shape ? object.shape[0].toUpperCase() + object.shape.slice(1) : 'Shape';
	return object.text || (object.type === 'svg' ? 'SVG' : 'Image');
}

/**
 * Hole cutter centered on the anchor: a shaft running `length` mm both ways
 * along local Y plus an optional countersink/counterbore opening toward +Y.
 */
export function createHoleGeometry(object, length) {
	const { Manifold } = getEngine();
	const radius = Math.max(0.1, (object.holeDiameter ?? 5) / 2);
	const head = Math.max(radius, (object.headDiameter ?? radius * 4) / 2);
	const segments = 48;
	return withTracking((track) => {
		let solid = track(Manifold.cylinder(2 * length, radius, radius, segments, true));
		if (object.head === 'countersink' && head > radius) {
			const cone = head - radius;
			solid = track(solid.add(track(track(Manifold.cylinder(cone, radius, head, segments)).translate([0, 0, -cone]))));
			solid = track(solid.add(track(Manifold.cylinder(length, head, head, segments))));
		} else if (object.head === 'counterbore' && head > radius) {
			const depth = Math.max(0.1, object.headDepth ?? 3);
			solid = track(solid.add(track(track(Manifold.cylinder(length + depth, head, head, segments)).translate([0, 0, -depth]))));
		}
		return solidToGeometry(track(solid.transform(Z_TO_Y_ARRAY)));
	});
}

function mirrorGeometry(geometry) {
	geometry.scale(-1, 1, 1);
	if (geometry.index) {
		const index = geometry.index.array;
		for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
		geometry.index.needsUpdate = true;
	} else {
		for (const attribute of Object.values(geometry.attributes)) {
			const { array, itemSize } = attribute;
			for (let vertex = 0; vertex < attribute.count; vertex += 3) {
				for (let component = 0; component < itemSize; component++) {
					const b = (vertex + 1) * itemSize + component, c = (vertex + 2) * itemSize + component;
					[array[b], array[c]] = [array[c], array[b]];
				}
			}
			attribute.needsUpdate = true;
		}
	}
	geometry.computeVertexNormals();
	return geometry;
}

/**
 * Owned geometry for any object type (caller disposes it). `holeLength`
 * sets how far hole cutters extend; previews pass a short length.
 */
export function createObjectGeometry(object, fonts, settings, holeLength = Math.hypot(settings.width, settings.height, settings.depth) + 20) {
	let geometry;
	switch (object.type) {
		case 'image': geometry = getMaskGeometry(object)?.clone(); break;
		case 'svg': geometry = getSvgGeometry(object)?.clone(); break;
		case 'shape': geometry = createShapeGeometry(object); break;
		case 'hole': return createHoleGeometry(object, holeLength);
		default: geometry = createTextGeometry(object.text, objectFont(fonts, object, settings), object);
	}
	return geometry && object.mirror ? mirrorGeometry(geometry) : geometry;
}
