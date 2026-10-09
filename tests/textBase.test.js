import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { buildModel, disposeGroup, initGeometryEngine } from '../src/lib/csg.js';
import { createBaseGeometry } from '../src/lib/baseShapes.js';
import { createBaseSolid } from '../src/lib/bodies.js';
import { applyBaseChange } from '../src/lib/baseSettings.js';
import { measureTextBase } from '../src/lib/textBase.js';
import { bufferToBase64, registerFonts } from '../src/lib/fonts.js';
import { facePlacementPreset } from '../src/lib/placement.js';
import { parseProject, serializeProject } from '../src/lib/project.js';
import { makeTestFont } from './fixtures/font.js';

await initGeometryEngine();
const load = (file) => new FontLoader().parse(JSON.parse(readFileSync(new URL(`../public/fonts/${file}`, import.meta.url))));
const fonts = { helvetiker: load('helvetiker.typeface.json'), helvetiker_bold: load('helvetiker_bold.typeface.json') };
registerFonts(fonts);

const base = {
	baseShape: 'box', width: 100, height: 6, depth: 60, cornerRadius: 0, chamfer: 0, chamferSegments: 1, radialSegments: 32, insetDepth: 2, mode: 'raised', font: 'helvetiker', objects: [],
	baseText: 'Hi', baseFont: 'helvetiker_bold', baseFontSize: 30, baseLetterSpacing: 0, baseLineHeight: 1, baseTextAlign: 'center',
	baseTextWeight: 0, baseBacking: 'none', baseBackingMargin: 3, baseBackingHeight: 2, baseTextOrientation: 'flat', baseTextDepth: 6,
	baseStand: true, baseStandHeight: 4, baseStandDepth: 20, baseStandMargin: 4,
};
const textBase = (patch = {}) => applyBaseChange(base, { baseShape: 'text', ...patch });

function near(actual, expected, tolerance = 0.0001) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
function pieces(settings) {
	const solid = createBaseSolid(settings);
	const parts = solid.decompose();
	const count = parts.length;
	for (const part of parts) part.delete();
	solid.delete();
	return count;
}

test('a flat text base sizes width and depth from the text and is as tall as the letter thickness', () => {
	const settings = textBase();
	const measured = measureTextBase(settings);
	assert.deepEqual([settings.width, settings.depth, settings.height], [measured.width, measured.depth, 6]);
	assert.ok(settings.width > 30 && settings.depth > 15, `${settings.width} x ${settings.depth}`);
	const geometry = createBaseGeometry(settings);
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	near(size.x, settings.width, 0.001); near(size.y, 6, 0.001); near(size.z, settings.depth, 0.001);
	geometry.dispose();
});

test('editing width scales the text uniformly instead of stretching it', () => {
	const settings = textBase({ baseLetterSpacing: 2, baseTextWeight: 0.5, baseBacking: 'outline' });
	const doubled = applyBaseChange(settings, { width: settings.width * 2 });
	near(doubled.baseFontSize, 60); near(doubled.baseLetterSpacing, 4); near(doubled.baseTextWeight, 1); near(doubled.baseBackingMargin, 6);
	near(doubled.width, settings.width * 2, 0.05); near(doubled.depth, settings.depth * 2, 0.05);
	assert.equal(doubled.height, settings.height);
	const thicker = applyBaseChange(settings, { height: 12 });
	assert.deepEqual([thicker.baseTextDepth, thicker.baseBackingHeight, thicker.width], [12, 4, settings.width]);
});

test('separate letters fuse into one piece with an outline or plate backing', () => {
	assert.ok(pieces(textBase()) > 1, 'loose letters print as several pieces');
	for (const baseBacking of ['outline', 'plate']) assert.equal(pieces(textBase({ baseBacking })), 1, baseBacking);
	assert.equal(pieces(textBase({ baseTextWeight: 6 })), 1, 'heavy weight merges letters');
});

test('weight, spacing and the plate margin change the footprint as expected', () => {
	const plain = textBase();
	const heavy = textBase({ baseTextWeight: 1 });
	near(heavy.width - plain.width, 2, 0.01); near(heavy.depth - plain.depth, 2, 0.01);
	const spaced = textBase({ baseLetterSpacing: 5 });
	near(spaced.width - plain.width, 5, 0.01);
	const plate = textBase({ baseBacking: 'plate', baseBackingMargin: 4 });
	near(plate.width - plain.width, 8, 0.01); near(plate.depth - plain.depth, 8, 0.01);
});

test('objects build on a text base as one closed model', () => {
	const settings = textBase({ baseBacking: 'plate', baseBackingHeight: 2, baseTextDepth: 5 });
	const object = { id: 1, type: 'text', text: 'x', fontSize: 6, curveSegments: 4, extrudeHeight: 1, mode: 'inset', insetDepth: 1, ...facePlacementPreset('top', settings) };
	near(object.pos.y, 2.5, 0.001);
	const group = buildModel({ ...settings, objects: [object] }, fonts);
	const mesh = group.getObjectByName('Base_Mesh');
	mesh.geometry.computeBoundingBox();
	near(mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y, 5, 0.001);
	disposeGroup(group);
});

test('an empty text base falls back to a box and keeps its last size', () => {
	const settings = textBase();
	const empty = applyBaseChange(settings, { baseText: '  ' });
	assert.deepEqual([empty.width, empty.depth], [settings.width, settings.depth]);
	const geometry = createBaseGeometry(empty);
	assert.ok(geometry.attributes.position.count > 0);
	geometry.dispose();
});

test('standing text sits upright on a stand, cut flat at the baseline', () => {
	const settings = textBase({ baseTextOrientation: 'standing', baseText: 'Hey', baseTextDepth: 5, baseStandDepth: 16, baseStandHeight: 3 });
	const flat = textBase({ baseText: 'Hey' });
	near(settings.width, flat.width + 8, 0.01);
	assert.equal(settings.depth, 16);
	const geometry = createBaseGeometry(settings);
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	near(size.x, settings.width, 0.001); near(size.y, settings.height, 0.001); near(size.z, 16, 0.001);
	geometry.dispose();
	assert.equal(pieces(settings), 1, 'letters stand on the stand');
	for (const baseBacking of ['none', 'plate']) assert.equal(pieces(textBase({ baseTextOrientation: 'standing', baseText: 'HI', baseBacking })), 1, `flat-bottomed letters fuse with the stand (${baseBacking})`);

	// Without the stand the letters stand on their own flat bottoms; the descender of the y is trimmed.
	const free = applyBaseChange(settings, { baseStand: false });
	near(free.height, settings.height - 3, 0.001);
	assert.equal(free.depth, 5);
	assert.ok(free.height < flat.depth - 3, `${free.height} vs ${flat.depth}`);

	// Height scales the lettering (and stand) uniformly; depth scales only the thicknesses.
	const taller = applyBaseChange(settings, { height: settings.height * 2 });
	near(taller.baseFontSize, 60); near(taller.baseStandHeight, 6);
	near(taller.height, settings.height * 2, 0.05); near(taller.width, settings.width * 2, 0.05);
	const deeper = applyBaseChange(settings, { depth: 32 });
	assert.deepEqual([deeper.baseTextDepth, deeper.baseStandDepth, deeper.depth, deeper.width], [10, 32, 32, settings.width]);
});

test('standing text reads from the front with its backing behind the letters', () => {
	const settings = textBase({ baseTextOrientation: 'standing', baseText: 'L', baseStand: false, baseBacking: 'plate', baseBackingMargin: 3, baseBackingHeight: 1, baseTextDepth: 5 });
	const geometry = createBaseGeometry(settings);
	const { min, max } = geometry.boundingBox;
	const positions = geometry.attributes.position;
	const vertices = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index));
	const front = vertices.filter((v) => v.z > max.z - 1e-4);
	assert.ok(Math.min(...front.map((v) => v.x)) > min.x + 2.5, 'only the letters reach the front');
	const letters = vertices.filter((v) => v.z > min.z + 1.5);
	const top = letters.reduce((a, b) => (b.y > a.y ? b : a));
	const foot = letters.filter((v) => v.y < Math.min(...letters.map((p) => p.y)) + 1e-4);
	assert.ok(top.x < 0, 'the stem of the L is on the left');
	assert.ok(Math.max(...foot.map((v) => v.x)) > 0, 'its foot points right');
	geometry.dispose();
});

function liftedParts(settings) {
	const solid = createBaseSolid(settings);
	const bottom = solid.boundingBox().min[1];
	const parts = solid.decompose();
	const result = { lifted: parts.filter((part) => part.boundingBox().min[1] > bottom + 1e-3).length, count: parts.length, volume: solid.volume() };
	for (const part of parts) part.delete();
	solid.delete();
	return result;
}

test('floating parts of standing text are bridged to the part below, removed or kept', () => {
	const standingText = (patch) => textBase({ baseTextOrientation: 'standing', baseText: 'ij:', baseStand: false, ...patch });
	const kept = liftedParts(standingText({ baseFloating: 'keep' }));
	assert.equal(kept.lifted, 3, 'two dots and the upper colon dot float');
	const removed = liftedParts(standingText({ baseFloating: 'remove' }));
	assert.equal(removed.lifted, 0);
	assert.ok(removed.volume < kept.volume);
	const connected = liftedParts(standingText({ baseFloating: 'connect' }));
	assert.equal(connected.lifted, 0);
	assert.equal(connected.count, 3, 'i, j and the colon each become one piece');
	assert.ok(connected.volume > kept.volume);
	const wider = liftedParts(standingText({ baseFloating: 'connect', baseBridgeWidth: 3 }));
	assert.ok(wider.volume > connected.volume);

	// On a stand, two lines become one piece; the upper line is bridged to the lower one.
	assert.equal(pieces(standingText({ baseText: 'ij\nHi', baseStand: true })), 1);
	assert.equal(standingText({ baseFloating: 'remove' }).width, standingText({ baseFloating: 'keep' }).width);
	assert.ok(applyBaseChange(standingText({}), { width: 200 }).baseBridgeWidth > 1.5, 'bridges scale with the lettering');
});

test('text base settings and uploaded base fonts survive save/load; bad values are dropped', () => {
	const data = bufferToBase64(makeTestFont());
	const settings = applyBaseChange({ ...base, customFonts: [{ id: 'custom-1', label: 'Blocks', data }] }, { baseShape: 'text', baseFont: 'custom-1', baseText: 'AB\nBA', baseTextAlign: 'left', baseBacking: 'plate', baseTextOrientation: 'standing', baseStand: false });
	assert.ok(settings.width > 0);
	const { settings: loaded } = parseProject(serializeProject(settings), base);
	for (const key of ['baseShape', 'baseFont', 'baseText', 'baseTextAlign', 'baseBacking', 'baseTextOrientation', 'baseStand', 'width', 'depth', 'height']) assert.equal(loaded[key], settings[key], key);
	const bad = JSON.parse(serializeProject({ ...settings, customFonts: [] }));
	Object.assign(bad.settings, { baseTextAlign: 'justify', baseBacking: 'glow', baseFontSize: 1e9, baseTextOrientation: 'sideways', baseStand: 'yes' });
	const { settings: cleaned } = parseProject(JSON.stringify(bad), base);
	assert.equal(cleaned.baseFont, 'helvetiker_bold');
	assert.equal(cleaned.baseTextAlign, 'center');
	assert.equal(cleaned.baseBacking, 'none');
	assert.equal(cleaned.baseFontSize, 500);
	assert.equal(cleaned.baseTextOrientation, 'flat');
	assert.equal(cleaned.baseStand, true);
});
