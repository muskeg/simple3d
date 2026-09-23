import * as THREE from 'three';
import { quaternionFromRot } from './placement.js';
import { getEngine, toSolid, solidToGeometry } from './engine.js';
import { createBaseSolid, createLidSolid, lidPrintMatrix } from './bodies.js';
import { createObjectGeometry, effectiveMode, firstWallDepth, objectBody } from './objects.js';
import { expandObjects } from './arrays.js';

export { initGeometryEngine } from './engine.js';

// Penetration offset so boolean unions/subtractions never share an exactly
// coplanar face (avoids degenerate slivers / open edges).
const PENETRATION = 0.05;

function makePreviewMaterial(color) {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.55,
		metalness: 0.05,
		flatShading: true,
	});
}

function resultMesh(solid, name, color, body) {
	if (solid.isEmpty()) return null;
	const mesh = new THREE.Mesh(solidToGeometry(solid), makePreviewMaterial(color));
	mesh.name = name;
	mesh.userData.body = body;
	return mesh;
}

/**
 * World placement for a model object.
 *
 * The unit geometry (height 1, bottom at y=-0.5, extrusion +Y) is scaled by
 * `height` and oriented by the object's quaternion. The anchor `pos` is the
 * surface contact point:
 *   raised      : anchor at the BOTTOM of the object, body extends along +Y
 *   inset       : anchor stays at the surface; the slab sinks `inset` below
 *   flush_inlay : the slab sinks by the object's inlayDepth below the anchor
 *   hole        : cutter geometry is already in mm and centered on the anchor
 */
export function placeObject(geom, obj, settings, mode = effectiveMode(obj, settings)) {
	const q = quaternionFromRot(obj.rot || { x: 0, y: 0, z: 0 });
	const pos = obj.pos || { x: 0, y: 0, z: 0 };
	const brush = new THREE.Mesh(geom, null);
	brush.quaternion.copy(q);
	if (mode === 'hole') {
		brush.position.set(pos.x, pos.y, pos.z);
		brush.updateMatrixWorld(true);
		return brush;
	}
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
	if (obj.type === 'mesh') {
		// Real-size mesh (bottom at local Y=0): raised sits on the anchor; cuts sink until the top is flush.
		if (!geom.boundingBox) geom.computeBoundingBox();
		const height = geom.boundingBox.max.y - geom.boundingBox.min.y;
		brush.position.set(pos.x, pos.y, pos.z).addScaledVector(up, mode === 'raised' ? -PENETRATION : PENETRATION - height);
		brush.updateMatrixWorld(true);
		return brush;
	}
	const e = Math.max(0.05, obj.extrudeHeight ?? 4);

	const depth = Math.max(0.001, mode === 'flush_inlay' ? obj.inlayDepth ?? 2 : obj.insetDepth ?? settings.insetDepth);
	const slab = (mode === 'raised' ? e : depth) + PENETRATION;

	brush.scale.set(1, Math.max(0.01, slab), 1);

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
 * Applies a body's objects in a fixed order so combinations stay predictable:
 *   1. inset / flush inlay cuts in object order (inlays partition the body)
 *   2. raised additions (removed from any inlay they overlap)
 *   3. holes, which cut through the body and its inlays
 */
function buildBody(body, bodySolid, settings, fonts, parent, track, release) {
	let result = bodySolid;
	const inlays = [];
	const objects = expandObjects((settings.objects || []).filter((object) => objectBody(object, settings) === body));
	// First-wall holes probe the body as it was before any object was applied.
	const bodyMesh = objects.some((object) => object.type === 'hole' && object.holeDepthMode === 'first')
		? new THREE.Mesh(solidToGeometry(bodySolid), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
		: null;
	const holeDepth = (object) => {
		if (object.holeDepthMode === 'fixed') return Math.max(0.1, object.holeDepth ?? 3);
		if (object.holeDepthMode === 'first') return firstWallDepth(object, bodyMesh) ?? undefined;
		return undefined;
	};
	// Array copies share their source's geometry; only the placement (and a first-wall depth) differs.
	const geometries = new Map();
	const cutterFor = (object, mode) => {
		const depth = mode === 'hole' ? holeDepth(object) : undefined;
		const key = depth === undefined ? object.id : `${object.id}|${depth}`;
		if (!geometries.has(key)) geometries.set(key, createObjectGeometry(object, fonts, settings, { holeDepth: depth }));
		const geometry = geometries.get(key);
		return geometry ? track(toSolid(geometry, placeObject(geometry, object, settings, mode).matrixWorld)) : null;
	};
	const replace = (previous, next) => { release(previous); return track(next); };
	try {
		for (const phase of [['inset', 'flush_inlay'], ['raised'], ['hole']]) {
			for (const object of objects) {
				const mode = effectiveMode(object, settings);
				if (!phase.includes(mode)) continue;
				const cutter = cutterFor(object, mode);
				if (!cutter) continue;
				if (mode === 'flush_inlay') inlays.push({ name: `Inlay_${object.id}${object.instance ? `.${object.instance}` : ''}`, solid: track(result.intersect(cutter)) });
				if (mode === 'raised') result = replace(result, result.add(cutter));
				else result = replace(result, result.subtract(cutter));
				if (mode === 'raised' || mode === 'hole') for (const inlay of inlays) inlay.solid = replace(inlay.solid, inlay.solid.subtract(cutter));
				release(cutter);
			}
		}
	} finally {
		for (const geometry of geometries.values()) geometry?.dispose();
		bodyMesh?.geometry.dispose();
		bodyMesh?.material.dispose();
	}
	for (const inlay of inlays) {
		const mesh = resultMesh(inlay.solid, inlay.name, 0xe8a33d, body);
		if (mesh) parent.add(mesh);
	}
	const mesh = resultMesh(result, body === 'lid' ? 'Lid_Mesh' : 'Base_Mesh', 0x8a93a6, body);
	if (mesh) parent.add(mesh);
}

/**
 * Builds the full multi-part model as a THREE.Group containing:
 *   - "Base_Mesh"   : the base body with its objects applied
 *   - "Inlay_<id>"  : one inlay part per flush-inlay object
 *   - "Lid" group   : Lid_Mesh + lid inlays, authored floating above the
 *                     base; userData.printMatrix lays it out for printing
 */
export function buildModel(settings, fonts) {
	getEngine();
	const group = new THREE.Group();
	group.name = 'Model';
	const solids = new Set();
	const track = (solid) => { solids.add(solid); return solid; };
	const release = (solid) => { if (solids.delete(solid)) solid.delete(); };
	try {
		buildBody('base', track(createBaseSolid(settings)), settings, fonts, group, track, release);
		const lidSolid = createLidSolid(settings);
		if (lidSolid) {
			const lid = new THREE.Group();
			lid.name = 'Lid';
			buildBody('lid', track(lidSolid), settings, fonts, lid, track, release);
			if (lid.children.length && group.children.length) {
				lid.userData.printMatrix = lidPrintMatrix(new THREE.Box3().setFromObject(group), new THREE.Box3().setFromObject(lid));
			}
			group.add(lid);
		}
		return group;
	} catch (error) {
		disposeGroup(group);
		throw new Error(`Unable to construct a closed solid: ${error.message || error}`);
	} finally {
		for (const solid of solids) solid.delete();
	}
}

/** Temporarily applies the lid print layout while `fn` runs synchronously. */
export function withPrintLayout(group, fn) {
	const lid = group?.getObjectByName('Lid');
	const matrix = lid?.userData.printMatrix;
	if (!matrix) return fn();
	const saved = { position: lid.position.clone(), quaternion: lid.quaternion.clone(), scale: lid.scale.clone() };
	matrix.decompose(lid.position, lid.quaternion, lid.scale);
	group.updateMatrixWorld(true);
	try {
		return fn();
	} finally {
		lid.position.copy(saved.position);
		lid.quaternion.copy(saved.quaternion);
		lid.scale.copy(saved.scale);
		group.updateMatrixWorld(true);
	}
}

/** Plain, transferable description of a built model (sent from the build worker). */
export function partsFromGroup(group) {
	const parts = [];
	group.traverse((mesh) => {
		if (!mesh.isMesh) return;
		parts.push({
			name: mesh.name,
			body: mesh.userData.body || 'base',
			color: mesh.material.color.getHex(),
			positions: mesh.geometry.attributes.position.array,
			indices: mesh.geometry.index.array,
		});
	});
	const lid = group.getObjectByName('Lid');
	return { parts, hasLid: !!lid, printMatrix: lid?.userData.printMatrix?.toArray() ?? null };
}

/** Rebuilds the model group produced by buildModel from partsFromGroup output. */
export function groupFromParts({ parts, hasLid, printMatrix }) {
	const group = new THREE.Group();
	group.name = 'Model';
	const lid = hasLid ? new THREE.Group() : null;
	if (lid) {
		lid.name = 'Lid';
		if (printMatrix) lid.userData.printMatrix = new THREE.Matrix4().fromArray(printMatrix);
	}
	for (const part of parts) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
		geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();
		const mesh = new THREE.Mesh(geometry, makePreviewMaterial(part.color));
		mesh.name = part.name;
		mesh.userData.body = part.body;
		(part.body === 'lid' && lid ? lid : group).add(mesh);
	}
	if (lid) group.add(lid);
	return group;
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
