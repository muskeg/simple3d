import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { buildModel, disposeGroup, initGeometryEngine } from '../src/lib/csg.js';
import { createTextGeometry } from '../src/lib/geometry.js';
import { bufferToBase64, parseFontData, objectFont, fontOptions } from '../src/lib/fonts.js';
import { alignObjects, bodyCenter, centerOnFace, distributeObjects, nudgeObjects, objectBounds, snapToGrid } from '../src/lib/align.js';
import { facePlacementPreset } from '../src/lib/placement.js';
import { parseProject, serializeProject } from '../src/lib/project.js';
import { makeTestFont } from './fixtures/font.js';

await initGeometryEngine();
const helvetiker = new FontLoader().parse(JSON.parse(readFileSync(new URL('../public/fonts/helvetiker.typeface.json', import.meta.url))));
const fonts = { helvetiker };
const blocksData = bufferToBase64(makeTestFont());
const blocks = parseFontData(blocksData);
const flat = { baseShape: 'box', width: 100, height: 12, depth: 60, cornerRadius: 0, chamfer: 0, chamferSegments: 1, radialSegments: 32, insetDepth: 2, mode: 'raised', font: 'helvetiker', objects: [] };
const top = { rot: { x: 0, y: 0, z: 0 }, face: 'top' };
const text = (id, value, x = 0, z = 0, extra = {}) => ({ id, type: 'text', text: value, fontSize: 10, curveSegments: 4, extrudeHeight: 2, pos: { x, y: 6, z }, ...top, ...extra });

function near(actual, expected, tolerance = 0.0001) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
function size(geometry) {
	geometry.computeBoundingBox();
	return geometry.boundingBox.getSize(new THREE.Vector3());
}
function points(geometry) {
	const positions = geometry.attributes.position;
	return Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index));
}
function closed(geometry) {
	const edges = new Map();
	const indices = geometry.index.array;
	for (let index = 0; index < indices.length; index += 3) {
		for (let edge = 0; edge < 3; edge++) {
			const start = indices[index + edge], end = indices[index + (edge + 1) % 3];
			const key = start < end ? `${start},${end}` : `${end},${start}`;
			edges.set(key, (edges.get(key) || 0) + 1);
		}
	}
	return [...edges.values()].every((count) => count === 2);
}

test('letter spacing widens text by exactly one gap per glyph pair', () => {
	const plain = createTextGeometry('AB', blocks, { fontSize: 10 });
	const spaced = createTextGeometry('AB', blocks, { fontSize: 10, letterSpacing: 5 });
	const single = createTextGeometry('A', blocks, { fontSize: 10 });
	near(size(spaced).x - size(plain).x, 5);
	near(size(plain).x - size(single).x, blocks.data.glyphs.A.ha * 10 / blocks.data.resolution);
	near(size(plain).y, 1);
	plain.dispose(); spaced.dispose(); single.dispose();
});

test('negative letter spacing merges overlapping glyphs into one closed solid', () => {
	const plain = createTextGeometry('AB', blocks, { fontSize: 10 });
	const single = createTextGeometry('A', blocks, { fontSize: 10 });
	const tight = createTextGeometry('AB', blocks, { fontSize: 10, letterSpacing: -3 });
	assert.ok(size(plain).x - size(single).x - 3 < size(single).x, 'glyphs should overlap');
	near(size(tight).x, size(plain).x - 3);
	assert.ok(closed(tight));
	plain.dispose(); single.dispose(); tight.dispose();
});

test('multi-line text stacks lines by the scaled line advance', () => {
	const one = createTextGeometry('AB', blocks, { fontSize: 10 });
	const two = createTextGeometry('AB\nAB', blocks, { fontSize: 10 });
	const loose = createTextGeometry('AB\nAB', blocks, { fontSize: 10, lineHeight: 2 });
	const advance = size(two).z - size(one).z;
	assert.ok(advance > 5);
	near(size(loose).z - size(one).z, advance * 2, 0.001);
	one.dispose(); two.dispose(); loose.dispose();
	assert.equal(createTextGeometry('\n  \n', blocks, { fontSize: 10 }), null);
});

test('alignment positions shorter lines left, centered or right', () => {
	const edges = (align) => {
		const geometry = createTextGeometry('AB\nA', blocks, { fontSize: 10, align });
		const all = points(geometry);
		const second = all.filter((point) => point.z > 0);
		const result = { min: Math.min(...all.map((p) => p.x)), max: Math.max(...all.map((p) => p.x)), lineMin: Math.min(...second.map((p) => p.x)), lineMax: Math.max(...second.map((p) => p.x)) };
		geometry.dispose();
		return result;
	};
	const left = edges('left'), right = edges('right'), center = edges('center');
	near(left.lineMin, left.min);
	near(right.lineMax, right.max);
	near((center.lineMin + center.lineMax) / 2, (center.min + center.max) / 2, 0.001);
});

test('uploaded fonts resolve by id and build closed models', () => {
	const settings = { ...flat, customFonts: [{ id: 'custom-1', label: 'Blocks', data: blocksData }] };
	const object = text(1, 'AB', 0, 0, { font: 'custom-1' });
	assert.equal(objectFont(fonts, object, settings), blocks);
	assert.deepEqual(fontOptions(settings).at(-1), { id: 'custom-1', label: 'Blocks' });
	assert.equal(objectFont(fonts, { ...object, font: 'custom-9' }, settings), helvetiker);
	const group = buildModel({ ...settings, objects: [object] }, fonts);
	for (const mesh of group.children) assert.ok(closed(mesh.geometry));
	disposeGroup(group);
	assert.throws(() => parseFontData(bufferToBase64(new Uint8Array([1, 2, 3, 4]).buffer)), /Unable to read font/);
});

test('project files keep uploaded fonts and reject invalid font entries', () => {
	const settings = { ...flat, customFonts: [{ id: 'custom-1', label: 'Blocks', data: blocksData }], objects: [text(1, 'AB', 0, 0, { font: 'custom-1', align: 'left', letterSpacing: 1.5, lineHeight: 1.2 })] };
	assert.deepEqual(parseProject(serializeProject(settings), flat).settings, settings);
	const orphan = JSON.parse(serializeProject({ ...settings, customFonts: [] }));
	assert.equal(parseProject(JSON.stringify(orphan), flat).settings.objects[0].font, undefined);
	const bad = JSON.parse(serializeProject(settings));
	bad.settings.customFonts[0].id = '../evil';
	assert.throws(() => parseProject(JSON.stringify(bad), flat), /Uploaded font 1 is invalid/);
	bad.settings.customFonts[0] = { id: 'custom-1', label: 'x', data: '<script>' };
	assert.throws(() => parseProject(JSON.stringify(bad), flat), /Uploaded font 1 is invalid/);
});

test('align moves bounding boxes to the selection min, center or max', () => {
	const objects = [text(1, 'A', -20, -10), text(2, 'AB', 5, 4), text(3, 'ABC', 30, 15)];
	for (const edge of ['min', 'center', 'max']) {
		const patches = alignObjects(objects, 'z', edge, fonts, flat);
		const boxes = objects.map((object) => objectBounds({ ...object, ...patches[object.id] }, fonts, flat));
		const pick = (box) => (edge === 'min' ? box.min.z : edge === 'max' ? box.max.z : (box.min.z + box.max.z) / 2);
		for (const box of boxes) near(pick(box), pick(boxes[0]), 0.001);
		for (const box of boxes) near(box.min.x, objectBounds(objects[boxes.indexOf(box)], fonts, flat).min.x, 0.001);
	}
	assert.deepEqual(alignObjects(objects.slice(0, 1), 'x', 'min', fonts, flat), {});
});

test('distribute spaces bounding boxes with equal gaps and keeps the ends fixed', () => {
	const objects = [text(1, 'A', -40, 0), text(2, 'ABC', -25, 0), text(3, 'AB', 35, 0), text(4, 'A', 10, 0)];
	const patches = distributeObjects(objects, 'x', fonts, flat);
	const boxes = objects.map((object) => objectBounds({ ...object, ...patches[object.id] }, fonts, flat)).sort((a, b) => a.min.x - b.min.x);
	const gaps = boxes.slice(1).map((box, index) => box.min.x - boxes[index].max.x);
	for (const gap of gaps) near(gap, gaps[0], 0.001);
	near(boxes[0].min.x, objectBounds(objects[0], fonts, flat).min.x, 0.001);
	near(boxes.at(-1).max.x, objectBounds(objects[2], fonts, flat).max.x, 0.001);
	assert.deepEqual(distributeObjects(objects.slice(0, 2), 'x', fonts, flat), {});
});

test('center on face moves within the surface plane only', () => {
	const topObject = text(1, 'A', 20, 10);
	assert.deepEqual(centerOnFace(topObject, flat).pos, { x: 0, y: 6, z: 0 });
	near(centerOnFace(topObject, flat, ['across']).pos.z, 10);
	const front = { ...text(2, 'A'), ...facePlacementPreset('front', flat), face: 'auto' };
	const moved = { ...front, pos: { x: 15, y: 2, z: 30 } };
	const across = centerOnFace(moved, flat, ['across']).pos;
	near(across.x, 0); near(across.y, 2); near(across.z, 30);
	const up = centerOnFace(moved, flat, ['up']).pos;
	near(up.x, 15); near(up.y, 0); near(up.z, 30);
});

test('nudge follows the reference reading axes and grid snapping rounds in-plane axes', () => {
	const a = text(1, 'A', 0, 0), b = text(2, 'B', 10, 5);
	const right = nudgeObjects([a, b], a, 'right', 1);
	assert.deepEqual([right[1].pos.x, right[2].pos.x], [1, 11]);
	near(nudgeObjects([a], a, 'up', 2)[1].pos.z, -2);
	const front = { ...a, ...facePlacementPreset('front', flat) };
	near(nudgeObjects([front], front, 'up', 3)[1].pos.y, front.pos.y + 3);
	assert.deepEqual(snapToGrid(new THREE.Vector3(1.26, 6.1, 3.74), new THREE.Vector3(0, 1, 0), 0.5).toArray(), [1.5, 6.1, 3.5]);
	assert.deepEqual(snapToGrid(new THREE.Vector3(1.26, 6.1, 3.74), new THREE.Vector3(0, 1, 0), 0).toArray(), [1.26, 6.1, 3.74]);
});

test('body center is the origin for the base and the lid bounding-box center for lids', () => {
	assert.deepEqual(bodyCenter(flat, 'base'), { x: 0, y: 0, z: 0 });
	const lid = bodyCenter({ ...flat, height: 30, shell: true, wall: 2, openTop: true, lid: true, lidThickness: 2, lipDepth: 4 }, 'lid');
	near(lid.x, 0, 0.001); near(lid.z, 0, 0.001); near(lid.y, (25 + 31) / 2, 0.001);
});
