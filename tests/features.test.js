import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { buildModel, disposeGroup, initGeometryEngine, withPrintLayout } from '../src/lib/csg.js';
import { createObjectGeometry } from '../src/lib/objects.js';
import { createShapeGeometry, SHAPE_KINDS } from '../src/lib/shapes2d.js';
import { facePlacementPreset } from '../src/lib/placement.js';
import { ThreeMFExporter } from '../src/lib/exporters.js';
import { parseProject, serializeProject } from '../src/lib/project.js';
import { PRESETS, presetSettings } from '../src/lib/presets.js';
import { FONTS } from '../src/lib/fonts.js';

await initGeometryEngine();
const loader = new FontLoader();
const fonts = Object.fromEntries(FONTS.map((font) => [font.id, loader.parse(JSON.parse(readFileSync(new URL(`../public/fonts/${font.file}`, import.meta.url))))]));
const flat = { baseShape: 'box', width: 100, height: 12, depth: 60, cornerRadius: 0, chamfer: 0, chamferSegments: 1, radialSegments: 32, insetDepth: 2, mode: 'raised', font: 'helvetiker', objects: [] };
const top = { pos: { x: 0, y: 6, z: 0 }, rot: { x: 0, y: 0, z: 0 }, face: 'top' };
const text = { id: 1, type: 'text', text: 'AB', fontSize: 12, curveSegments: 4, extrudeHeight: 3, ...top };
const hole = { id: 9, type: 'hole', holeDiameter: 6, ...top };
const polygonArea = (radius, segments = 48) => 0.5 * segments * radius * radius * Math.sin((2 * Math.PI) / segments);

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
const boxVolume = flat.width * flat.depth * flat.height;

test('per-object modes mix raised and inset objects on one body', () => {
	const raisedOnly = buildModel({ ...flat, objects: [text] }, fonts);
	const mixed = buildModel({ ...flat, objects: [text, { ...text, id: 2, pos: { x: 0, y: 6, z: 18 }, mode: 'inset', insetDepth: 5 }] }, fonts);
	const bounds = new THREE.Box3().setFromObject(mixed);
	near(bounds.max.y, 9);
	assert.ok(volume(mixed) < volume(raisedOnly) - 50);
	assertClosed(mixed);
	disposeGroup(raisedOnly); disposeGroup(mixed);
});

test('inset objects cut before raised ones, so raised text survives inside a pocket', () => {
	const pocket = { id: 3, type: 'shape', shape: 'rect', fontSize: 60, shapeHeight: 30, mode: 'inset', insetDepth: 2, ...top };
	const inPocket = { ...text, pos: { x: 0, y: 4, z: 0 } };
	const group = buildModel({ ...flat, objects: [pocket, inPocket] }, fonts);
	const alone = buildModel({ ...flat, objects: [pocket] }, fonts);
	near(new THREE.Box3().setFromObject(group).max.y, 7);
	assert.ok(volume(group) > volume(alone) + 10);
	disposeGroup(group); disposeGroup(alone);
});

test('mirroring keeps a positive closed solid and flips reading direction', () => {
	const plain = createObjectGeometry({ ...text, text: 'L' }, fonts, flat);
	const mirrored = createObjectGeometry({ ...text, text: 'L', mirror: true }, fonts, flat);
	const plainMesh = new THREE.Mesh(plain), mirroredMesh = new THREE.Mesh(mirrored);
	near(volume(mirroredMesh), volume(plainMesh), 0.001);
	assert.ok(volume(plainMesh) > 0);
	const positionsAt = (geometry) => [...geometry.attributes.position.array].filter((_, index) => index % 3 === 0);
	near(Math.max(...positionsAt(mirrored)), -Math.min(...positionsAt(plain)));
	const group = buildModel({ ...flat, objects: [{ ...text, mirror: true }] }, fonts);
	assertClosed(group);
	plain.dispose(); mirrored.dispose(); disposeGroup(group);
});

test('plain holes cut exactly through the body', () => {
	const group = buildModel({ ...flat, objects: [hole] }, fonts);
	near(volume(group), boxVolume - polygonArea(3) * flat.height, 0.01);
	assertClosed(group);
	disposeGroup(group);
});

test('countersunk and counterbored holes remove more material than plain holes', () => {
	const plain = boxVolume - polygonArea(3) * flat.height;
	const sunk = buildModel({ ...flat, objects: [{ ...hole, head: 'countersink', headDiameter: 12 }] }, fonts);
	const bored = buildModel({ ...flat, objects: [{ ...hole, head: 'counterbore', headDiameter: 12, headDepth: 4 }] }, fonts);
	assert.ok(volume(sunk) < plain - 10);
	near(volume(bored), plain - (polygonArea(6) - polygonArea(3)) * 4, 0.01);
	assertClosed(sunk); assertClosed(bored);
	disposeGroup(sunk); disposeGroup(bored);
});

test('holes cut through inlays and raised objects too', () => {
	const inlay = { ...text, text: 'O', fontSize: 20, mode: 'flush_inlay', inlayDepth: 3 };
	const withoutHole = buildModel({ ...flat, objects: [inlay] }, fonts);
	const withHole = buildModel({ ...flat, objects: [inlay, { ...hole, holeDiameter: 30 }] }, fonts);
	const inlayVolume = (group) => volume(group, (mesh) => mesh.name.startsWith('Inlay_'));
	assert.ok(inlayVolume(withHole) < inlayVolume(withoutHole) - 1);
	const raised = buildModel({ ...flat, objects: [{ ...text, text: 'O', fontSize: 20 }, { ...hole, holeDiameter: 30 }] }, fonts);
	near(new THREE.Box3().setFromObject(raised).max.y, 6);
	near(volume(raised), boxVolume - polygonArea(15) * flat.height, 0.01);
	disposeGroup(withoutHole); disposeGroup(withHole); disposeGroup(raised);
});

test('first-wall holes cross only the near wall of a hollow body', () => {
	const shell = { ...flat, height: 30, shell: true, wall: 2, openTop: false };
	const onTop = { ...hole, pos: { x: 0, y: 15, z: 0 } };
	const empty = buildModel(shell, fonts);
	const through = buildModel({ ...shell, objects: [onTop] }, fonts);
	const first = buildModel({ ...shell, objects: [{ ...onTop, holeDepthMode: 'first' }] }, fonts);
	near(volume(through), volume(empty) - 2 * polygonArea(3) * 2, 0.01);
	near(volume(first), volume(empty) - polygonArea(3) * 2, 0.01);
	assertClosed(first);
	disposeGroup(empty); disposeGroup(through); disposeGroup(first);
});

test('first-wall holes still go all the way through a solid body; fixed depths are blind', () => {
	const first = buildModel({ ...flat, objects: [{ ...hole, holeDepthMode: 'first' }] }, fonts);
	near(volume(first), boxVolume - polygonArea(3) * flat.height, 0.01);
	const blind = buildModel({ ...flat, objects: [{ ...hole, holeDepthMode: 'fixed', holeDepth: 5 }] }, fonts);
	near(volume(blind), boxVolume - polygonArea(3) * 5, 0.01);
	assertClosed(blind);
	disposeGroup(first); disposeGroup(blind);
});

test('first-wall radial holes in a curved hollow wall leave no slivers at the rim', () => {
	const tube = { ...flat, baseShape: 'cylinder', width: 60, depth: 60, height: 40, radialSegments: 64, shell: true, wall: 3, openTop: false };
	const radial = { ...hole, holeDiameter: 10, ...facePlacementPreset('right', tube) };
	const build = (patch) => { const group = buildModel({ ...tube, objects: [{ ...radial, ...patch }] }, fonts); const result = volume(group); disposeGroup(group); return result; };
	const first = build({ holeDepthMode: 'first' });
	// A fixed depth well past the wall (but short of the far side) removes exactly the first wall's material.
	near(first, build({ holeDepthMode: 'fixed', holeDepth: 8 }), 0.01);
	// Stopping where the center line exits would leave material at the rim.
	assert.ok(build({ holeDepthMode: 'fixed', holeDepth: 3.05 }) > first + 0.5);
	assert.ok(build({ holeDepthMode: 'through' }) < first - 50);
});

for (const kind of SHAPE_KINDS) {
	test(`${kind.id} shape has an exact footprint and builds a closed solid`, () => {
		const shape = { id: 4, type: 'shape', shape: kind.id, fontSize: 30, shapeHeight: 18, sides: 6, innerRatio: 0.4, cornerRadius: 3, ...top };
		const geometry = createShapeGeometry(shape);
		geometry.computeBoundingBox();
		const size = geometry.boundingBox.getSize(new THREE.Vector3());
		near(size.x, 30); near(size.y, 1); near(size.z, 18);
		geometry.dispose();
		for (const mode of ['raised', 'inset', 'flush_inlay']) {
			const group = buildModel({ ...flat, mode, objects: [shape] }, fonts);
			assert.ok(volume(group) > 0);
			assertClosed(group);
			disposeGroup(group);
		}
	});
}

test('tube and torus face presets land on the ring, not the hollow center', () => {
	const tube = { ...flat, baseShape: 'tube', tubeWall: 5 };
	const placement = facePlacementPreset('top', tube);
	near(placement.pos.y, 6, 0.001);
	assert.ok(Math.abs(placement.pos.x) > 45 && Math.abs(placement.pos.x) < 50);
	const torus = facePlacementPreset('top', { ...flat, baseShape: 'torus', height: 10, width: 60, depth: 60 });
	assert.ok(torus.pos.y > 4 && Math.abs(torus.pos.x) > 10);
});

test('ngon base has flat front and back faces', () => {
	const front = facePlacementPreset('front', { ...flat, baseShape: 'ngon', sides: 6, width: 100, depth: 86.6 });
	near(front.pos.z, 43.3, 0.001);
	near(front.pos.x, 0, 0.001);
});

test('open and closed shells remove the exact cavity volume', () => {
	const wall = 2;
	const open = buildModel({ ...flat, shell: true, wall, openTop: true }, fonts);
	near(volume(open), boxVolume - (100 - 2 * wall) * (60 - 2 * wall) * (12 - wall), 0.05);
	const closed = buildModel({ ...flat, shell: true, wall, openTop: false }, fonts);
	near(volume(closed), boxVolume - (100 - 2 * wall) * (60 - 2 * wall) * (12 - 2 * wall), 0.05);
	assertClosed(open); assertClosed(closed);
	disposeGroup(open); disposeGroup(closed);
});

test('shell is ignored for shapes that cannot be offset evenly', () => {
	const sphere = buildModel({ ...flat, baseShape: 'sphere', shell: true, wall: 2 }, fonts);
	const solid = buildModel({ ...flat, baseShape: 'sphere' }, fonts);
	near(volume(sphere), volume(solid), 0.001);
	disposeGroup(sphere); disposeGroup(solid);
});

test('lid plate and lip fit the cavity with the requested clearance', () => {
	const config = { ...flat, height: 30, shell: true, wall: 2, openTop: true, lid: true, lidThickness: 2, lipDepth: 4, lidClearance: 0.25 };
	const group = buildModel(config, fonts);
	const lid = group.getObjectByName('Lid');
	const lidMesh = group.getObjectByName('Lid_Mesh');
	assert.ok(lid && lidMesh);
	assert.equal(lidMesh.userData.body, 'lid');
	const lipWidth = 100 - 2 * (2 + 0.25), lipDepthZ = 60 - 2 * (2 + 0.25);
	near(volume(lid), 100 * 60 * 2 + lipWidth * lipDepthZ * 4, 0.05);
	const bounds = new THREE.Box3().setFromObject(lidMesh);
	near(bounds.min.y, 15 + 10);
	const positions = lidMesh.geometry.attributes.position;
	const lipXs = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index)).filter((point) => point.y < bounds.min.y + 3.9).map((point) => point.x);
	near(Math.max(...lipXs) - Math.min(...lipXs), lipWidth, 0.001);
	assertClosed(group);
	disposeGroup(group);
});

test('print layout flips the lid beside the base on the same floor and exports two build items', () => {
	const config = { ...flat, height: 30, shell: true, wall: 2, openTop: true, lid: true, lidThickness: 2, lipDepth: 4, objects: [{ ...text, target: 'lid', ...facePlacementPreset('top', { ...flat, height: 30, shell: true, wall: 2, openTop: true, lid: true, lidThickness: 2, lipDepth: 4 }, 'lid') }] };
	const group = buildModel(config, fonts);
	const base = new THREE.Box3().setFromObject(group.getObjectByName('Base_Mesh'));
	const assembled = new THREE.Box3().setFromObject(group.getObjectByName('Lid'));
	near(assembled.max.y, 15 + 4 + 10 + 2 + 3);
	withPrintLayout(group, () => {
		const laidOut = new THREE.Box3().setFromObject(group.getObjectByName('Lid'));
		near(laidOut.min.y, base.min.y);
		assert.ok(laidOut.min.x >= base.max.x + 9.99);
		const xml = ThreeMFExporter.serializeObject(group);
		assert.equal((xml.match(/<item /g) || []).length, 2);
		assert.match(xml, /name="Simple3D_Lid"/);
	});
	near(new THREE.Box3().setFromObject(group.getObjectByName('Lid')).max.y, assembled.max.y);
	disposeGroup(group);
});

test('lid objects are skipped when the lid is disabled', () => {
	const group = buildModel({ ...flat, objects: [{ ...text, target: 'lid' }] }, fonts);
	near(volume(group), boxVolume, 0.001);
	assert.equal(group.getObjectByName('Lid'), undefined);
	disposeGroup(group);
});

test('project files round-trip and reject or clamp untrusted values', () => {
	const settings = { ...flat, shell: true, lid: true, objects: [{ ...text, mode: 'inset', mirror: true, target: 'lid' }, { ...hole, head: 'countersink', headDiameter: 10, holeDepthMode: 'first', holeDepth: 4 }] };
	const { settings: loaded, maxId } = parseProject(serializeProject(settings), flat);
	assert.deepEqual(loaded, settings);
	assert.equal(maxId, 9);
	const hostile = JSON.parse(serializeProject(settings));
	hostile.settings.width = 1e9;
	hostile.settings.baseShape = '<script>';
	hostile.settings.objects[0].fontSize = -5;
	hostile.settings.objects[0].extra = 'ignored';
	hostile.settings.objects[1].id = 1;
	const { settings: clamped } = parseProject(JSON.stringify(hostile), flat);
	assert.equal(clamped.width, 800);
	assert.equal(clamped.baseShape, 'box');
	assert.equal(clamped.objects[0].fontSize, 0.5);
	assert.equal(clamped.objects[0].extra, undefined);
	assert.notEqual(clamped.objects[0].id, clamped.objects[1].id);
	assert.throws(() => parseProject('{"app":"other","version":1,"settings":{}}', flat), /Not a Simple 3D project/);
	assert.throws(() => parseProject('not json', flat), /not valid JSON/);
	const badImage = JSON.parse(serializeProject({ ...flat, objects: [{ ...text, type: 'image', image: 'javascript:alert(1)' }] }));
	assert.throws(() => parseProject(JSON.stringify(badImage), flat), /invalid image data/);
	const badType = JSON.parse(serializeProject({ ...flat, objects: [{ ...text, type: 'script' }] }));
	assert.throws(() => parseProject(JSON.stringify(badType), flat), /unsupported type/);
});

for (const preset of PRESETS) {
	test(`${preset.id} preset builds a closed printable model`, () => {
		let id = 0;
		const settings = presetSettings(preset.id, { ...flat, cornerRadius: 10, chamfer: 2.5, wall: 2, openTop: true, lidThickness: 2, lipDepth: 4, lidClearance: 0.2, sides: 6, tubeWall: 3 }, (fields) => ({ id: ++id, curveSegments: 4, extrudeHeight: 4, inlayDepth: 2, ...fields }));
		assert.equal(settings.objects.length, preset.objects.length);
		const group = buildModel(settings, fonts);
		assert.ok(volume(group) > 0);
		assertClosed(group);
		if (preset.id === 'box') assert.ok(group.getObjectByName('Lid_Mesh'));
		if (preset.id === 'dice') assert.equal(group.children.filter((child) => child.name.startsWith('Inlay_')).length, 6);
		disposeGroup(group);
	});
}
