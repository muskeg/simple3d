import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { buildModel, disposeGroup, initGeometryEngine } from '../src/lib/csg.js';
import { createBaseGeometry } from '../src/lib/baseShapes.js';
import { loadMeshFile } from '../src/lib/meshImport.js';
import { decodeMesh, encodeMesh, rotateMesh } from '../src/lib/meshData.js';
import { applyBaseChange } from '../src/lib/baseSettings.js';
import { facePlacementPreset } from '../src/lib/placement.js';
import { parseProject, serializeProject } from '../src/lib/project.js';
import { asciiSTL, binarySTL, boxTriangles, inverted, objFile } from './fixtures/meshes.js';

await initGeometryEngine();
const fonts = { helvetiker: new FontLoader().parse(JSON.parse(readFileSync(new URL('../public/fonts/helvetiker.typeface.json', import.meta.url)))) };
const flat = { baseShape: 'box', width: 100, height: 12, depth: 60, cornerRadius: 0, chamfer: 0, chamferSegments: 1, radialSegments: 32, insetDepth: 2, mode: 'raised', font: 'helvetiker', objects: [] };
// 20 mm wide, 10 mm deep and 30 mm tall in a Z-up print file.
const printBox = boxTriangles([0, 0, 0], [20, 10, 30]);

function near(actual, expected, tolerance = 0.0001) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
function volume(root, filter = () => true) {
	let result = 0;
	root.updateMatrixWorld(true);
	root.traverse((mesh) => {
		if (!mesh.isMesh || !filter(mesh)) return;
		const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
		const positions = geometry.attributes.position;
		for (let index = 0; index < positions.count; index += 3) {
			const [a, b, c] = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(positions, index + offset).applyMatrix4(mesh.matrixWorld));
			result += a.dot(b.cross(c)) / 6;
		}
		if (geometry !== mesh.geometry) geometry.dispose();
	});
	return result;
}
const recordVolume = (record) => volume(new THREE.Mesh(decodeMesh(record)));
function assertClosed(group) {
	group.traverse((mesh) => {
		if (!mesh.isMesh) return;
		const edges = new Map();
		const indices = mesh.geometry.index.array;
		for (let index = 0; index < indices.length; index += 3) {
			for (let edge = 0; edge < 3; edge++) {
				const start = indices[index + edge], end = indices[index + (edge + 1) % 3];
				const key = start < end ? `${start},${end}` : `${end},${start}`;
				edges.set(key, (edges.get(key) || 0) + 1);
			}
		}
		assert.ok([...edges.values()].every((count) => count === 2), `${mesh.name} has open edges`);
	});
}

test('binary and ASCII STL import as Z-up print files at real size', () => {
	for (const buffer of [binarySTL(printBox), asciiSTL(printBox)]) {
		const record = loadMeshFile('part.stl', buffer);
		assert.deepEqual(record.size, { x: 20, y: 30, z: 10 });
		assert.equal(record.triangleCount, 12);
		assert.equal(record.name, 'part.stl');
		near(recordVolume(record), 6000, 0.001);
		const bounds = decodeMesh(record).boundingBox;
		near(bounds.min.y, -15); near(bounds.max.y, 15);
	}
});

test('OBJ imports as Y-up', () => {
	const record = loadMeshFile('part.obj', objFile(boxTriangles([0, 0, 0], [20, 30, 10])));
	assert.deepEqual(record.size, { x: 20, y: 30, z: 10 });
});

test('inside-out meshes are flipped and overlapping parts unioned', () => {
	near(recordVolume(loadMeshFile('flipped.stl', binarySTL(inverted(printBox)))), 6000, 0.001);
	const overlapping = [...boxTriangles([0, 0, 0], [10, 10, 10]), ...boxTriangles([5, 0, 0], [15, 10, 10])];
	near(recordVolume(loadMeshFile('overlap.stl', binarySTL(overlapping))), 1500, 0.001);
});

test('inward-facing inner shells become cavities', () => {
	const hollow = [...boxTriangles([0, 0, 0], [10, 10, 10]), ...inverted(boxTriangles([2, 2, 2], [8, 8, 8]))];
	near(recordVolume(loadMeshFile('hollow.stl', binarySTL(hollow))), 1000 - 216, 0.001);
});

test('open, empty, oversized and unsupported files are rejected with clear messages', () => {
	assert.throws(() => loadMeshFile('open.stl', binarySTL(printBox.slice(1))), /not a closed solid/);
	assert.throws(() => loadMeshFile('empty.stl', binarySTL([])), /no triangles/);
	assert.throws(() => loadMeshFile('dense.stl', binarySTL(printBox), { maxTriangles: 10 }), /12 triangles; the limit is 10/);
	assert.throws(() => loadMeshFile('model.step', new ArrayBuffer(8)), /Choose an STL, OBJ or 3MF file/);
	assert.throws(() => loadMeshFile('broken.3mf', new TextEncoder().encode('not a zip').buffer), /Unable to read 3MF file/);
});

test('custom bases scale to W/D/H and keep proportions by default', () => {
	const record = loadMeshFile('part.stl', binarySTL(printBox));
	const base = { ...flat, baseShape: 'custom', customMesh: record, meshLock: true, width: 20, height: 30, depth: 10 };
	const scaled = applyBaseChange(base, { width: 40 });
	assert.deepEqual([scaled.width, scaled.height, scaled.depth], [40, 60, 20]);
	const stretched = applyBaseChange({ ...base, meshLock: false }, { width: 40 });
	assert.deepEqual([stretched.width, stretched.height, stretched.depth], [40, 30, 10]);
	const geometry = createBaseGeometry(scaled);
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	near(size.x, 40); near(size.y, 60); near(size.z, 20);
	geometry.dispose();
	const settings = { ...scaled, objects: [{ id: 1, type: 'text', text: 'A', fontSize: 8, curveSegments: 4, extrudeHeight: 2, ...facePlacementPreset('top', scaled) }] };
	near(settings.objects[0].pos.y, 30, 0.001);
	const group = buildModel(settings, fonts);
	assert.ok(volume(group) > 48000);
	assertClosed(group);
	disposeGroup(group);
});

test('rotating a mesh 90 degrees permutes its size and keeps it solid', () => {
	const record = loadMeshFile('part.stl', binarySTL(printBox));
	assert.deepEqual(rotateMesh(record, 'x').size, { x: 20, y: 10, z: 30 });
	assert.deepEqual(rotateMesh(record, 'y').size, { x: 10, y: 30, z: 20 });
	assert.deepEqual(rotateMesh(record, 'z').size, { x: 30, y: 20, z: 10 });
	near(recordVolume(rotateMesh(record, 'z')), 6000, 0.001);
});

test('mesh objects sit on the surface when raised and sink flush when cut', () => {
	const cube = loadMeshFile('cube.stl', binarySTL(boxTriangles([0, 0, 0], [5, 5, 5])));
	const object = { id: 2, type: 'mesh', mesh: cube, fontSize: 10, pos: { x: 0, y: 6, z: 0 }, rot: { x: 0, y: 0, z: 0 }, face: 'top' };
	const raised = buildModel({ ...flat, objects: [object] }, fonts);
	near(new THREE.Box3().setFromObject(raised).max.y, 6 + 10 - 0.05, 0.001);
	near(volume(raised), 100 * 60 * 12 + 1000 - 100 * 0.05, 0.01);
	const inset = buildModel({ ...flat, objects: [{ ...object, mode: 'inset' }] }, fonts);
	near(volume(inset), 100 * 60 * 12 - 100 * (10 - 0.05), 0.01);
	const inlay = buildModel({ ...flat, objects: [{ ...object, mode: 'flush_inlay' }] }, fonts);
	near(volume(inlay, (mesh) => mesh.name.startsWith('Inlay_')), 100 * (10 - 0.05), 0.01);
	for (const group of [raised, inset, inlay]) { assertClosed(group); disposeGroup(group); }
});

test('projects keep custom meshes and reject malformed mesh data', () => {
	const record = loadMeshFile('part.stl', binarySTL(printBox));
	const cube = loadMeshFile('cube.stl', binarySTL(boxTriangles([0, 0, 0], [5, 5, 5])));
	const settings = { ...flat, baseShape: 'custom', customMesh: record, meshLock: false, objects: [{ id: 3, type: 'mesh', mesh: cube, fontSize: 5, pos: { x: 0, y: 6, z: 0 }, rot: { x: 0, y: 0, z: 0 }, face: 'top' }] };
	assert.deepEqual(parseProject(serializeProject(settings), flat).settings, settings);
	const withoutMesh = JSON.parse(serializeProject({ ...settings, customMesh: null }));
	assert.equal(parseProject(JSON.stringify(withoutMesh), flat).settings.baseShape, 'box');
	const bad = JSON.parse(serializeProject(settings));
	bad.settings.customMesh.vertices = '<svg onload=alert(1)>';
	assert.throws(() => parseProject(JSON.stringify(bad), flat), /custom base has invalid mesh data/);
	const outOfRange = encodeMesh('bad', new Float32Array(9), new Uint32Array([0, 1, 7]));
	assert.throws(() => decodeMesh(outOfRange), /Mesh data is invalid/);
});
