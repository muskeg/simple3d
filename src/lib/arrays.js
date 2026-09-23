import * as THREE from 'three';
import { quaternionFromRot, rotFromQuaternion } from './placement.js';

export const ARRAY_KINDS = [
	{ id: 'none', label: 'No array' },
	{ id: 'linear', label: 'Linear array' },
	{ id: 'grid', label: 'Grid array' },
	{ id: 'circular', label: 'Circular array' },
];
export const MAX_ARRAY_INSTANCES = 400;

const int = (value, fallback) => Math.max(1, Math.round(Number.isFinite(value) ? value : fallback));

/**
 * Placements ({ pos, rot }) of every copy in an object's array, the original
 * first. Offsets follow the object's reading axes in its surface plane:
 * linear/grid step along "across" (+X) and rows go "down" (+Z local);
 * circular copies orbit a center `arrayRadius` below the original, clockwise
 * as seen from outside, optionally turning with the circle.
 */
export function arrayInstances(object) {
	const kind = object.arrayKind || 'none';
	const original = { pos: object.pos, rot: object.rot };
	if (kind === 'none') return [original];
	const quaternion = quaternionFromRot(object.rot);
	const across = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
	const down = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
	const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
	const origin = new THREE.Vector3(object.pos.x, object.pos.y, object.pos.z);
	const at = (point) => ({ x: point.x, y: point.y, z: point.z });
	const count = Math.min(int(object.arrayCount, 3), MAX_ARRAY_INSTANCES);
	const result = [];
	if (kind === 'circular') {
		const radius = Math.max(0.1, object.arrayRadius ?? 20);
		const sweep = Math.min(360, Math.max(1, object.arraySweep ?? 360));
		const step = sweep >= 360 ? 360 / count : sweep / Math.max(1, count - 1);
		const center = origin.clone().addScaledVector(down, radius);
		for (let k = 0; k < count; k++) {
			const turn = new THREE.Quaternion().setFromAxisAngle(normal, -THREE.MathUtils.degToRad(k * step));
			const pos = at(origin.clone().sub(center).applyQuaternion(turn).add(center));
			result.push({ pos, rot: object.arrayRotate === false ? object.rot : rotFromQuaternion(turn.multiply(quaternion.clone())) });
		}
		return result;
	}
	const rows = kind === 'grid' ? Math.min(int(object.arrayRows, 2), Math.floor(MAX_ARRAY_INSTANCES / count)) : 1;
	const spacing = object.arraySpacing ?? 20;
	const rowSpacing = object.arrayRowSpacing ?? 20;
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < count; column++) {
			result.push({ pos: at(origin.clone().addScaledVector(across, column * spacing).addScaledVector(down, row * rowSpacing)), rot: object.rot });
		}
	}
	return result;
}

/** Flattens arrays into plain objects; copies keep the source id and get an `instance` index. */
export function expandObjects(objects) {
	return objects.flatMap((object) => arrayInstances(object).map((placement, instance) => (instance === 0 ? object : { ...object, ...placement, instance })));
}
