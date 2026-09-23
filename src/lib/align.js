import * as THREE from 'three';
import { createObjectGeometry, objectBody } from './objects.js';
import { placeObject } from './csg.js';
import { facePlacementPreset, quaternionFromRot, rotationPresetForFace } from './placement.js';
import { createBodyGeometry } from './bodies.js';

const AXES = ['x', 'y', 'z'];
const NAMED_FACES = ['top', 'bottom', 'front', 'back', 'left', 'right'];
const UP = new THREE.Vector3(0, 1, 0);

/** World-space bounding box of an object's geometry, or null if it has none. */
export function objectBounds(object, fonts, settings) {
	const geometry = createObjectGeometry(object, fonts, settings, { holeLength: 0.5 });
	if (!geometry) return null;
	try {
		return new THREE.Box3().setFromObject(placeObject(geometry, object, settings), true);
	} finally {
		geometry.dispose();
	}
}

const shift = (object, axis, delta) => ({ pos: { ...object.pos, [axis]: object.pos[axis] + delta }, face: 'auto' });

/**
 * Aligns the objects' bounding boxes on a world axis to the selection's
 * min, center or max. Returns { [id]: patch }.
 */
export function alignObjects(objects, axis, edge, fonts, settings) {
	const boxes = objects.map((object) => [object, objectBounds(object, fonts, settings)]).filter(([, box]) => box);
	if (boxes.length < 2) return {};
	const union = boxes.reduce((all, [, box]) => all.union(box), new THREE.Box3());
	const pick = (box) => (edge === 'min' ? box.min[axis] : edge === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2);
	const target = pick(union);
	return Object.fromEntries(boxes.map(([object, box]) => [object.id, shift(object, axis, target - pick(box))]));
}

/** Spaces three or more objects with equal gaps between their bounding boxes on a world axis. */
export function distributeObjects(objects, axis, fonts, settings) {
	const boxes = objects.map((object) => [object, objectBounds(object, fonts, settings)]).filter(([, box]) => box);
	if (boxes.length < 3) return {};
	boxes.sort(([, a], [, b]) => (a.min[axis] + a.max[axis]) - (b.min[axis] + b.max[axis]));
	const sizes = boxes.map(([, box]) => box.max[axis] - box.min[axis]);
	const span = boxes.at(-1)[1].max[axis] - boxes[0][1].min[axis];
	const gap = (span - sizes.reduce((sum, size) => sum + size, 0)) / (boxes.length - 1);
	let cursor = boxes[0][1].min[axis];
	return Object.fromEntries(boxes.map(([object, box], index) => {
		const patch = shift(object, axis, cursor - box.min[axis]);
		cursor += sizes[index] + gap;
		return [object.id, patch];
	}));
}

/** Local reading axes of an object in world space: across (+X) and up (-Z). */
export function objectAxes(object) {
	const quaternion = quaternionFromRot(object.rot);
	return {
		normal: UP.clone().applyQuaternion(quaternion),
		across: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
		up: new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion),
	};
}

/**
 * Moves an object within its surface plane to the center of the named face
 * its normal points to most closely. `directions` is a subset of across/up.
 */
export function centerOnFace(object, settings, directions = ['across', 'up']) {
	const axes = objectAxes(object);
	const face = NAMED_FACES.reduce((best, candidate) => {
		const normal = UP.clone().applyQuaternion(rotationPresetForFace(candidate).quaternion);
		return normal.dot(axes.normal) > best.score ? { face: candidate, score: normal.dot(axes.normal) } : best;
	}, { face: 'top', score: -Infinity }).face;
	const center = facePlacementPreset(face, settings, objectBody(object, settings) || 'base').pos;
	const pos = new THREE.Vector3(object.pos.x, object.pos.y, object.pos.z);
	const delta = new THREE.Vector3(center.x, center.y, center.z).sub(pos);
	for (const direction of directions) pos.addScaledVector(axes[direction], delta.dot(axes[direction]));
	return { pos: { x: pos.x, y: pos.y, z: pos.z }, face: 'auto' };
}

/** Bounding-box center of a body; every base shape is authored centered on the origin. */
export function bodyCenter(settings, body) {
	if (body !== 'lid') return { x: 0, y: 0, z: 0 };
	const geometry = createBodyGeometry(settings, 'lid');
	if (!geometry) return { x: 0, y: 0, z: 0 };
	geometry.computeBoundingBox();
	const center = geometry.boundingBox.getCenter(new THREE.Vector3());
	geometry.dispose();
	return { x: center.x, y: center.y, z: center.z };
}

/** Moves every object by the same world offset, measured along `reference`'s reading axes. */
export function nudgeObjects(objects, reference, direction, step) {
	const axis = objectAxes(reference)[direction === 'left' || direction === 'right' ? 'across' : 'up'];
	const offset = axis.multiplyScalar(direction === 'left' || direction === 'down' ? -step : step);
	return Object.fromEntries(objects.map((object) => [object.id, { pos: Object.fromEntries(AXES.map((key) => [key, object.pos[key] + offset[key]])), face: 'auto' }]));
}

/** Rounds the in-plane components of a world point (those not along `normal`) to `step`. */
export function snapToGrid(point, normal, step) {
	if (!(step > 0)) return point;
	for (const axis of AXES) if (Math.abs(normal[axis]) < 0.5) point[axis] = Math.round(point[axis] / step) * step;
	return point;
}
