import * as THREE from 'three';
import { createBodyGeometry } from './bodies.js';

/**
 * Placement math for model objects (text / image masks).
 *
 * An object's geometry is authored as a unit prism: flat side on the local
 * XZ plane, extrusion toward local +Y, "read across" = +X, "read up" = -Z,
 * centered on the origin with height 1. The world transform (position +
 * quaternion + Y-scale) places and orients it.
 *
 * Object state:
 *   pos: {x,y,z}  - anchor point (for raised: the surface contact point,
 *                   i.e. the BOTTOM of the extrusion)
 *   rot: {x,y,z}  - Euler degrees, 'XYZ' order (typeable source of truth)
 *   face: 'top'|'bottom'|'front'|'back'|'left'|'right'|'auto'
 */

export const FACES = ['top', 'bottom', 'front', 'back', 'left', 'right', 'auto'];

// Per-face orthonormal basis (columns of the rotation matrix).
// y = extrusion normal (out of the face), x = read-across, z = read-up.
const FACE_BASIS = {
	top: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
	bottom: { x: [1, 0, 0], y: [0, -1, 0], z: [0, 0, -1] },
	front: { x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] },
	back: { x: [-1, 0, 0], y: [0, 0, -1], z: [0, -1, 0] },
	left: { x: [0, 0, 1], y: [-1, 0, 0], z: [0, -1, 0] },
	right: { x: [0, 0, -1], y: [1, 0, 0], z: [0, -1, 0] },
};

const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const AXIS_VECTORS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/**
 * Rotation preset for a face: maps the object's local frame so the object
 * sits upright and reads correctly on that face. Returns { rot, quaternion }.
 */
export function rotationPresetForFace(face) {
	const basis = FACE_BASIS[face] || FACE_BASIS.top;
	tmpMatrix.makeBasis(
		new THREE.Vector3().fromArray(basis.x),
		new THREE.Vector3().fromArray(basis.y),
		new THREE.Vector3().fromArray(basis.z),
	);
	tmpQuat.setFromRotationMatrix(tmpMatrix);
	tmpEuler.setFromQuaternion(tmpQuat, 'XYZ');
	return {
		rot: { x: THREE.MathUtils.radToDeg(tmpEuler.x), y: THREE.MathUtils.radToDeg(tmpEuler.y), z: THREE.MathUtils.radToDeg(tmpEuler.z) },
		quaternion: tmpQuat.clone(),
	};
}

/**
 * Default anchor point for a face, given base dimensions.
 * 'auto' lands centered on the top face.
 */
export function facePositionPreset(face, base) {
	const hw = base.width / 2;
	const hd = base.depth / 2;
	const h = base.height;
	switch (face) {
		case 'bottom': return { x: 0, y: -h / 2, z: 0 };
		case 'front': return { x: 0, y: 0, z: hd };
		case 'back': return { x: 0, y: 0, z: -hd };
		case 'left': return { x: -hw, y: 0, z: 0 };
		case 'right': return { x: hw, y: 0, z: 0 };
		case 'top':
		case 'auto':
		default: return { x: 0, y: h / 2, z: 0 };
	}
}

/** Quaternion from typeable Euler degrees ('XYZ' order). */
export function quaternionFromRot(rot) {
	return new THREE.Quaternion().setFromEuler(new THREE.Euler(
		THREE.MathUtils.degToRad(rot.x),
		THREE.MathUtils.degToRad(rot.y),
		THREE.MathUtils.degToRad(rot.z),
		'XYZ',
	));
}

/**
 * Rotate the object about a WORLD axis by angle degrees.
 * Result is world-axis-anchored: after the turn the object's axis that
 * pointed along `axis` still points along it (bakes into Euler state).
 * Returns { rot, quaternion }.
 */
export function rotateAboutWorldAxis(rot, axis, angleDeg) {
	const q = quaternionFromRot(rot);
	const a = typeof axis === 'string' ? AXIS_VECTORS[axis] || AXIS_VECTORS.y : new THREE.Vector3(axis.x, axis.y, axis.z);
	if (![a.x, a.y, a.z, angleDeg].every(Number.isFinite) || a.lengthSq() === 0) throw new Error('Rotation requires a finite, nonzero axis and a finite angle.');
	a.normalize();
	tmpQuat.setFromAxisAngle(a, THREE.MathUtils.degToRad(angleDeg));
	q.premultiply(tmpQuat);
	tmpEuler.setFromQuaternion(q, 'XYZ');
	return {
		rot: { x: THREE.MathUtils.radToDeg(tmpEuler.x), y: THREE.MathUtils.radToDeg(tmpEuler.y), z: THREE.MathUtils.radToDeg(tmpEuler.z) },
		quaternion: q,
	};
}

export function rotFromQuaternion(quaternion) {
	const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
	return { x: THREE.MathUtils.radToDeg(euler.x), y: THREE.MathUtils.radToDeg(euler.y), z: THREE.MathUtils.radToDeg(euler.z) };
}

export function surfacePlacement(point, normal, rot) {
	const quaternion = quaternionFromRot(rot);
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
	quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize()));
	return { pos: { x: point.x, y: point.y, z: point.z }, rot: rotFromQuaternion(quaternion), face: 'auto' };
}

export function facePlacementPreset(face, settings, target = 'base') {
	const geometry = createBodyGeometry(settings, target);
	const preset = rotationPresetForFace(face);
	if (!geometry) return { pos: facePositionPreset(face, settings), rot: preset.rot, face };
	const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
	geometry.computeBoundingBox();
	const center = geometry.boundingBox.getCenter(new THREE.Vector3());
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(preset.quaternion);
	const across = new THREE.Vector3(1, 0, 0).applyQuaternion(preset.quaternion);
	const distance = size.length() + 1;
	const ray = new THREE.Raycaster();
	const castAt = (offset) => {
		ray.set(center.clone().addScaledVector(across, offset).addScaledVector(normal, distance), normal.clone().negate());
		return ray.intersectObject(mesh)[0];
	};
	let hit = castAt(0);
	if (!hit) {
		// Hollow centers (tube, torus): land in the middle of the first solid band beside the center.
		const half = Math.abs(across.dot(size)) / 2;
		const band = [];
		for (let step = 1; step <= 96; step++) {
			const offset = half * step / 96;
			if (castAt(offset)) band.push(offset);
			else if (band.length) break;
		}
		if (band.length) hit = castAt(band[Math.floor(band.length / 2)]);
	}
	const placement = hit ? surfacePlacement(hit.point, hit.face.normal, preset.rot) : { pos: facePositionPreset(face, settings), rot: preset.rot };
	geometry.dispose();
	mesh.material.dispose();
	return { ...placement, face };
}
