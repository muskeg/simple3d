import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { createBaseGeometry, BASE_SHAPES } from '../src/lib/baseShapes.js';
import { createTextGeometry } from '../src/lib/geometry.js';
import { buildModel, disposeGroup, placeObject, initGeometryEngine } from '../src/lib/csg.js';
import { quaternionFromRot, rotationPresetForFace, facePlacementPreset, surfacePlacement, rotateAboutWorldAxis } from '../src/lib/placement.js';

const settings = { baseShape: 'box', width: 100, height: 12, depth: 60, cornerRadius: 4, chamfer: 2.5, chamferSegments: 1, radialSegments: 17, insetDepth: 8, mode: 'raised' };
const font = new FontLoader().parse(JSON.parse(readFileSync(new URL('../public/fonts/helvetiker.typeface.json', import.meta.url))));
await initGeometryEngine();
const object = { id: 1, type: 'text', text: 'O', fontSize: 12, curveSegments: 4, extrudeHeight: 4, pos: { x: 0, y: 6, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
function near(actual, expected, tolerance = 0.0001) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
function volume(group) {
	let result = 0;
	group.updateMatrixWorld(true);
	group.traverse((mesh) => {
		if (!mesh.isMesh) return;
		const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
		const positions = geometry.attributes.position;
		for (let index = 0; index < positions.count; index += 3) {
			const vertices = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(positions, index + offset).applyMatrix4(mesh.matrixWorld));
			result += vertices[0].dot(vertices[1].cross(vertices[2])) / 6;
		}
		if (geometry !== mesh.geometry) geometry.dispose();
	});
	return result;
}

for (const shape of BASE_SHAPES) {
	test(`${shape.id}: exact bounding box at odd tessellation and asymmetric dimensions`, () => {
		const geometry = createBaseGeometry({ ...settings, baseShape: shape.id });
		const size = geometry.boundingBox.getSize(new THREE.Vector3());
		near(size.x, 100); near(size.y, 12); near(size.z, 60);
		assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
		geometry.dispose();
	});
}

test('raised height is exact and penetrates the anchor', () => {
	const geometry = new THREE.BoxGeometry(10, 1, 10);
	const brush = placeObject(geometry, object, settings, 'raised');
	const bounds = new THREE.Box3().setFromObject(brush);
	near(bounds.max.y, 10); near(bounds.min.y, 5.95);
	geometry.dispose();
});

test('inset depth is independent of extrusion height', () => {
	const geometry = new THREE.BoxGeometry(10, 1, 10);
	const bounds = new THREE.Box3().setFromObject(placeObject(geometry, object, settings, 'inset'));
	near(bounds.min.y, -2); near(bounds.max.y, 6.05);
	geometry.dispose();
});

test('empty text creates no substituted geometry', () => {
	assert.equal(createTextGeometry('  ', font, object), null);
});

test('zero corner radius and sub-millimeter dimensions remain valid solids', () => {
	const group = buildModel({ ...settings, width: 0.5, height: 0.2, depth: 0.3, cornerRadius: 0, chamfer: 0, objects: [] }, font);
	near(volume(group), 0.03, 0.00001);
	disposeGroup(group);
});

test('custom axis-angle normalizes vectors and rejects zero axes', () => {
	const result = rotateAboutWorldAxis({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, 75);
	const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), THREE.MathUtils.degToRad(75));
	near(result.quaternion.angleTo(expected), 0);
	assert.throws(() => rotateAboutWorldAxis({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 10));
});

test('face rotations point extrusion outward', () => {
	for (const [face, expected] of Object.entries({ top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] })) {
		const actual = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionFromRot(rotationPresetForFace(face).rot));
		near(actual.distanceTo(new THREE.Vector3(...expected)), 0);
	}
});

test('overlapping inlays partition the original base volume', () => {
	const base = buildModel({ ...settings, objects: [] }, font);
	for (const offset of [0, 3]) {
		const inlay = buildModel({ ...settings, mode: 'flush_inlay', objects: [object, { ...object, id: 2, pos: { ...object.pos, x: offset } }] }, font);
		near(volume(inlay), volume(base), 0.1);
		disposeGroup(inlay);
	}
	disposeGroup(base);
});

test('pyramid side snap uses its slope, not a bounding-box plane', () => {
	const placement = facePlacementPreset('right', { ...settings, baseShape: 'pyramid' });
	near(placement.pos.x, 25);
	near(placement.pos.y, 0);
	const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionFromRot(placement.rot));
	assert.ok(normal.x > 0 && normal.y > 0);
});

test('surface snapping preserves quaternion orientation while aligning the normal', () => {
	const normal = new THREE.Vector3(1, 2, 3).normalize();
	const placement = surfacePlacement(new THREE.Vector3(4, 5, 6), normal, { x: 25, y: 70, z: -30 });
	near(new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionFromRot(placement.rot)).distanceTo(normal), 0);
	assert.deepEqual(placement.pos, { x: 4, y: 5, z: 6 });
});

for (const mode of ['raised', 'inset', 'flush_inlay']) {
	test(`${mode}: all output parts have closed indexed topology`, () => {
		const group = buildModel({ ...settings, mode, objects: [{ ...object, text: 'ABC' }] }, font);
		for (const mesh of group.children) {
			const indices = mesh.geometry.index.array;
			const edges = new Map();
			for (let index = 0; index < indices.length; index += 3) {
				for (let edge = 0; edge < 3; edge++) {
					const start = indices[index + edge], end = indices[index + (edge + 1) % 3];
					const key = start < end ? `${start},${end}` : `${end},${start}`;
					edges.set(key, (edges.get(key) || 0) + 1);
				}
			}
			assert.ok([...edges.values()].every((count) => count === 2), mesh.name);
		}
		disposeGroup(group);
	});
}

for (const shape of BASE_SHAPES) {
	for (const mode of ['raised', 'inset', 'flush_inlay']) {
		test(`${shape.id}/${mode}: oriented side object builds a finite solid`, () => {
			const config = { ...settings, baseShape: shape.id, mode };
			const placement = facePlacementPreset('right', config);
			const group = buildModel({ ...config, objects: [{ ...object, fontSize: 4, ...placement }] }, font);
			assert.ok(group.children.length > 0);
			assert.ok(volume(group) > 0);
			for (const mesh of group.children) assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
			disposeGroup(group);
		});
	}
}