import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { buildModel, disposeGroup, groupFromParts, initGeometryEngine, partsFromGroup } from '../src/lib/csg.js';
import { arrayInstances, expandObjects, MAX_ARRAY_INSTANCES } from '../src/lib/arrays.js';
import { facePlacementPreset, quaternionFromRot } from '../src/lib/placement.js';
import { parseProject, serializeProject } from '../src/lib/project.js';

await initGeometryEngine();
const fonts = { helvetiker: new FontLoader().parse(JSON.parse(readFileSync(new URL('../public/fonts/helvetiker.typeface.json', import.meta.url)))) };
const flat = { baseShape: 'box', width: 100, height: 12, depth: 60, cornerRadius: 0, chamfer: 0, chamferSegments: 1, radialSegments: 32, insetDepth: 2, mode: 'raised', font: 'helvetiker', objects: [] };
const text = { id: 1, type: 'text', text: 'A', fontSize: 8, curveSegments: 4, extrudeHeight: 2, inlayDepth: 1, pos: { x: -20, y: 6, z: 0 }, rot: { x: 0, y: 0, z: 0 }, face: 'top' };

function near(actual, expected, tolerance = 0.0001) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
const nearVector = (actual, expected) => { for (const axis of ['x', 'y', 'z']) near(actual[axis], expected[axis], 0.0001); };

test('no array returns only the original placement', () => {
	assert.deepEqual(arrayInstances(text), [{ pos: text.pos, rot: text.rot }]);
	assert.deepEqual(expandObjects([text]), [text]);
});

test('linear and grid arrays step along the reading axes', () => {
	const linear = arrayInstances({ ...text, arrayKind: 'linear', arrayCount: 3, arraySpacing: 15 });
	assert.deepEqual(linear.map((entry) => entry.pos.x), [-20, -5, 10]);
	const grid = arrayInstances({ ...text, arrayKind: 'grid', arrayCount: 2, arraySpacing: 10, arrayRows: 3, arrayRowSpacing: 8 });
	assert.equal(grid.length, 6);
	nearVector(grid[5].pos, { x: -10, y: 6, z: 16 });
	const front = { ...text, ...facePlacementPreset('front', flat), arrayKind: 'grid', arrayCount: 2, arraySpacing: 10, arrayRows: 2, arrayRowSpacing: 4 };
	nearVector(arrayInstances(front)[3].pos, { x: front.pos.x + 10, y: front.pos.y - 4, z: front.pos.z });
});

test('circular arrays orbit clockwise around a center below the original', () => {
	const ring = arrayInstances({ ...text, pos: { x: 0, y: 6, z: -15 }, arrayKind: 'circular', arrayCount: 4, arrayRadius: 15 });
	const expected = [{ x: 0, z: -15 }, { x: 15, z: 0 }, { x: 0, z: 15 }, { x: -15, z: 0 }];
	ring.forEach((entry, index) => nearVector(entry.pos, { ...expected[index], y: 6 }));
	const across = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternionFromRot(ring[1].rot));
	nearVector(across, { x: 0, y: 0, z: 1 });
	const fixed = arrayInstances({ ...text, arrayKind: 'circular', arrayCount: 4, arrayRadius: 15, arrayRotate: false });
	assert.ok(fixed.every((entry) => entry.rot === text.rot));
	const arc = arrayInstances({ ...text, pos: { x: 0, y: 6, z: -10 }, arrayKind: 'circular', arrayCount: 3, arrayRadius: 10, arraySweep: 90 });
	nearVector(arc[2].pos, { x: 10, y: 6, z: 0 });
});

test('array sizes are capped', () => {
	assert.equal(arrayInstances({ ...text, arrayKind: 'grid', arrayCount: 100, arrayRows: 100 }).length, MAX_ARRAY_INSTANCES);
	assert.equal(arrayInstances({ ...text, arrayKind: 'linear', arrayCount: 9999 }).length, MAX_ARRAY_INSTANCES);
});

test('arrayed inlays and holes build distinct closed parts', () => {
	const settings = { ...flat, mode: 'flush_inlay', objects: [
		{ ...text, arrayKind: 'linear', arrayCount: 3, arraySpacing: 15 },
		{ id: 2, type: 'hole', holeDiameter: 3, pos: { x: 30, y: 6, z: -20 }, rot: { x: 0, y: 0, z: 0 }, face: 'auto', arrayKind: 'grid', arrayCount: 2, arraySpacing: 10, arrayRows: 2, arrayRowSpacing: 10 },
	] };
	const group = buildModel(settings, fonts);
	assert.deepEqual(group.children.map((mesh) => mesh.name).sort(), ['Base_Mesh', 'Inlay_1', 'Inlay_1.1', 'Inlay_1.2']);
	const segments = 48;
	const holeArea = 0.5 * segments * 1.5 * 1.5 * Math.sin((2 * Math.PI) / segments);
	let volume = 0;
	for (const mesh of group.children) {
		const geometry = mesh.geometry.toNonIndexed();
		const positions = geometry.attributes.position;
		for (let index = 0; index < positions.count; index += 3) {
			const [a, b, c] = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(positions, index + offset));
			volume += a.dot(b.cross(c)) / 6;
		}
		geometry.dispose();
	}
	near(volume, 100 * 60 * 12 - 4 * holeArea * 12, 0.05);
	disposeGroup(group);
});

test('worker model transfer preserves parts, bodies and the lid layout', () => {
	const settings = { ...flat, height: 30, shell: true, wall: 2, openTop: true, lid: true, lidThickness: 2, lipDepth: 4, mode: 'flush_inlay', objects: [{ ...text, pos: { x: 0, y: 6, z: 0 } }] };
	settings.objects[0] = { ...settings.objects[0], ...facePlacementPreset('front', settings) };
	const original = buildModel(settings, fonts);
	const rebuilt = groupFromParts(structuredClone(partsFromGroup(original)));
	const describe = (group) => {
		const list = [];
		group.traverse((mesh) => { if (mesh.isMesh) list.push([mesh.name, mesh.userData.body, mesh.geometry.attributes.position.count, mesh.geometry.index.count, mesh.material.color.getHex()]); });
		return list;
	};
	assert.deepEqual(describe(rebuilt), describe(original));
	assert.deepEqual(rebuilt.getObjectByName('Lid').userData.printMatrix.toArray(), original.getObjectByName('Lid').userData.printMatrix.toArray());
	assert.equal(rebuilt.getObjectByName('Lid_Mesh').parent.name, 'Lid');
	disposeGroup(original); disposeGroup(rebuilt);
});

test('project files keep array settings and clamp them', () => {
	const settings = { ...flat, objects: [{ ...text, arrayKind: 'circular', arrayCount: 6, arrayRadius: 12, arraySweep: 180, arrayRotate: false, arraySpacing: -5, arrayRows: 2, arrayRowSpacing: 3 }] };
	assert.deepEqual(parseProject(serializeProject(settings), flat).settings, settings);
	const hostile = JSON.parse(serializeProject(settings));
	Object.assign(hostile.settings.objects[0], { arrayKind: 'spiral', arrayCount: 1e6, arraySweep: -20, arrayRotate: 'yes' });
	const object = parseProject(JSON.stringify(hostile), flat).settings.objects[0];
	assert.equal(object.arrayKind, undefined);
	assert.equal(object.arrayCount, 400);
	assert.equal(object.arraySweep, 1);
	assert.equal(object.arrayRotate, undefined);
});
