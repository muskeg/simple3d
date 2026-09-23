import { facePlacementPreset } from './placement.js';
import { lidOrigin, shellEnabled, shellWall } from './bodies.js';
import { objectBody } from './objects.js';

// Base keys that move faces, so face-snapped objects are re-snapped.
export const RESNAP_KEYS = ['baseShape', 'sides', 'tubeWall', 'shell', 'wall', 'openTop', 'lid', 'lidThickness', 'lipDepth', 'customMesh'];
const DIMENSIONS = ['width', 'height', 'depth'];

/**
 * Applies a base-settings patch: clamps dependent values, keeps custom-mesh
 * proportions when one dimension changes (unless meshLock is false), then
 * re-snaps face-attached objects or scales positions with the new size.
 */
export function applyBaseChange(s, patch) {
	const next = { ...s, ...patch };
	const keys = Object.keys(patch);
	if (next.baseShape === 'custom' && next.meshLock !== false && keys.length === 1 && DIMENSIONS.includes(keys[0]) && s[keys[0]] > 0) {
		const factor = patch[keys[0]] / s[keys[0]];
		for (const key of DIMENSIONS) if (key !== keys[0]) next[key] = s[key] * factor;
	}
	next.cornerRadius = Math.min(next.cornerRadius, Math.min(next.width, next.depth) / 2);
	next.chamfer = Math.min(next.chamfer, Math.min(next.width, next.depth, next.height) * 0.45);
	if (shellEnabled(next)) next.chamfer = Math.min(next.chamfer, shellWall(next) * 0.5);
	const resnap = keys.some((key) => RESNAP_KEYS.includes(key));
	if (!resnap && !DIMENSIONS.some((key) => next[key] !== s[key])) return next;
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
	return next;
}
