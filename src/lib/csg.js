import * as THREE from 'three';
import ManifoldModule from 'manifold-3d';
import { createBaseGeometry } from './baseShapes.js';
import { createTextGeometry } from './geometry.js';
import { getMaskGeometry } from './mask.js';
import { quaternionFromRot } from './placement.js';
import { objectFont } from './fonts.js';

// Penetration offset so boolean unions/subtractions never share an exactly
// coplanar face (avoids degenerate slivers / open edges).
const PENETRATION = 0.05;
let engine;
let enginePromise;

export function initGeometryEngine(wasmURL) {
	enginePromise ??= ManifoldModule(wasmURL ? { locateFile: () => wasmURL } : undefined).then((module) => {
		module.setup();
		engine = module;
		return module;
	});
	return enginePromise;
}

function makePreviewMaterial(color) {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.55,
		metalness: 0.05,
		flatShading: true,
	});
}

function toSolid(geometry, matrix = new THREE.Matrix4()) {
	const transformed = geometry.clone().applyMatrix4(matrix);
	try {
		const positions = transformed.attributes.position;
		const indices = transformed.index ? new Uint32Array(transformed.index.array) : Uint32Array.from({ length: positions.count }, (_, index) => index);
		const mesh = new engine.Mesh({ numProp: 3, vertProperties: new Float32Array(positions.array), triVerts: indices });
		mesh.merge();
		return new engine.Manifold(mesh);
	} finally {
		transformed.dispose();
	}
}

function resultMesh(solid, name, color) {
	if (solid.isEmpty()) return null;
	const data = solid.getMesh();
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.vertProperties), 3));
	geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.triVerts), 1));
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh(geometry, makePreviewMaterial(color));
	mesh.name = name;
	return mesh;
}

/**
 * World placement for a model object (text / image).
 *
 * The unit geometry (height 1, bottom at y=-0.5, extrusion +Y) is scaled by
 * `height` and oriented by the object's quaternion. The anchor `pos` is the
 * surface contact point:
 *   raised      : anchor at the BOTTOM of the object, body extends along +Y
 *   inset       : anchor stays at the surface; the slab sinks `inset` below
 *   flush_inlay : the slab sinks by the object's inlayDepth below the anchor
 */
export function placeObject(geom, obj, settings, mode) {
	const q = quaternionFromRot(obj.rot || { x: 0, y: 0, z: 0 });
	const e = Math.max(0.05, obj.extrudeHeight ?? 4);
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

	const depth = Math.max(0.001, mode === 'flush_inlay' ? obj.inlayDepth ?? 2 : settings.insetDepth);
	const slab = (mode === 'raised' ? e : depth) + PENETRATION;

	const brush = new THREE.Mesh(geom, null);
	brush.scale.set(1, Math.max(0.01, slab), 1);
	brush.quaternion.copy(q);

	const pos = obj.pos || { x: 0, y: 0, z: 0 };
	if (mode === 'raised') {
		// Bottom face sits on the anchor; body extends along +Y (slightly
		// overlapping the surface for a watertight union).
		brush.position.set(pos.x, pos.y, pos.z).addScaledVector(up, (e - PENETRATION) / 2);
	} else {
		brush.position.set(pos.x, pos.y, pos.z).addScaledVector(up, (PENETRATION - depth) / 2);
	}
	brush.updateMatrixWorld(true);
	return brush;
}

/**
 * Builds the full multi-part model as a THREE.Group containing:
 *   - "Base_Mesh"  : the base plate (with every object unioned/carved)
 *   - "Text_Inlay_i": (flush inlay mode) one inlay mesh per object, each
 *                     filling that object's carved cavity exactly.
 *
 * Modes (global, applied to all objects):
 *   raised       -> ADDITION(base, object on top)
 *   inset        -> SUBTRACTION(base, object sunk partly below the surface)
 *   flush_inlay  -> SUBTRACTION(base, object slab) + INTERSECTION inlay
 */
export function buildModel(settings, font) {
	if (!engine) throw new Error('Geometry engine is not initialized.');
	const group = new THREE.Group();
	group.name = 'Model';
	const solids = new Set();
	const track = (solid) => { solids.add(solid); return solid; };
	const release = (solid) => { solid.delete(); solids.delete(solid); };
	try {
		const baseGeometry = createBaseGeometry(settings);
		let result;
		try { result = track(toSolid(baseGeometry)); } finally { baseGeometry.dispose(); }
		for (const object of settings.objects || []) {
			const geometry = object.type === 'image' ? getMaskGeometry(object)?.clone() : createTextGeometry(object.text, objectFont(font, object, settings), object);
			if (!geometry) continue;
			let cutter;
			try {
				const placement = placeObject(geometry, object, settings, settings.mode);
				cutter = track(toSolid(geometry, placement.matrixWorld));
			} finally { geometry.dispose(); }
			if (settings.mode === 'flush_inlay') {
				const inlay = track(result.intersect(cutter));
				const mesh = resultMesh(inlay, `Inlay_${object.id}`, 0xe8a33d);
				if (mesh) group.add(mesh);
				release(inlay);
			}
			const previous = result;
			result = track(settings.mode === 'raised' ? result.add(cutter) : result.subtract(cutter));
			release(previous);
			release(cutter);
		}
		const mesh = resultMesh(result, 'Base_Mesh', 0x8a93a6);
		if (mesh) group.add(mesh);
		return group;
	} catch (error) {
		disposeGroup(group);
		throw new Error(`Unable to construct a closed solid: ${error.message || error}`);
	} finally {
		for (const solid of solids) solid.delete();
	}
}

/** Disposes every geometry/material/bvh in a group. */
export function disposeGroup(group) {
	if (!group) return;
	group.traverse((obj) => {
		if (obj.isMesh) {
			obj.geometry?.userData?.bvh?.dispose?.();
			obj.geometry?.dispose?.();
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
			mats.forEach((m) => m?.dispose?.());
		}
	});
}
