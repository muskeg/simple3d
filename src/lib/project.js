import { BASE_SHAPES } from './baseShapes.js';
import { FONTS } from './fonts.js';
import { FACES } from './placement.js';
import { SHAPE_KINDS } from './shapes2d.js';
import { OBJECT_MODES, HOLE_HEADS } from './objects.js';
import { MAX_SVG_BYTES } from './svg.js';

export const PROJECT_APP = 'simple3d';
export const PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const MAX_OBJECTS = 200;

const SETTINGS_NUMBERS = {
	width: [0.1, 800], depth: [0.1, 800], height: [0.1, 400], cornerRadius: [0, 400], chamfer: [0, 100],
	chamferSegments: [1, 16], radialSegments: [8, 128], sides: [3, 12], tubeWall: [0.2, 100], wall: [0.4, 50],
	lidThickness: [0.4, 50], lipDepth: [0, 100], lidClearance: [0, 2], insetDepth: [0.1, 100],
};
const SETTINGS_BOOLEANS = ['shell', 'openTop', 'lid'];
const OBJECT_NUMBERS = {
	fontSize: [0.5, 300], curveSegments: [2, 32], extrudeHeight: [0.05, 200], inlayDepth: [0.1, 100], insetDepth: [0.1, 100],
	threshold: [1, 255], maskResolution: [32, 1024], shapeHeight: [0.5, 300], sides: [3, 24], innerRatio: [0.1, 0.95],
	cornerRadius: [0, 150], holeDiameter: [0.2, 200], headDiameter: [0.2, 300], headDepth: [0.1, 100],
};
const INTEGER_KEYS = new Set(['chamferSegments', 'radialSegments', 'sides', 'curveSegments', 'threshold', 'maskResolution']);
const ids = (list) => list.map((entry) => entry.id);
const OBJECT_ENUMS = {
	type: ['text', 'image', 'svg', 'shape', 'hole'],
	mode: ids(OBJECT_MODES),
	target: ['base', 'lid'],
	font: ids(FONTS),
	shape: ids(SHAPE_KINDS),
	head: ids(HOLE_HEADS),
	maskChannel: ['alpha', 'dark', 'light'],
	face: FACES,
};
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export function serializeProject(settings) {
	return JSON.stringify({ app: PROJECT_APP, version: PROJECT_VERSION, settings });
}

function number(value, [min, max], integer) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const clamped = Math.min(max, Math.max(min, value));
	return integer ? Math.round(clamped) : clamped;
}

function vector(value, limit) {
	if (!value || typeof value !== 'object') return null;
	const result = {};
	for (const axis of ['x', 'y', 'z']) {
		const component = number(value[axis], [-limit, limit]);
		if (component === undefined) return null;
		result[axis] = component;
	}
	return result;
}

function sanitizeObject(raw, index) {
	if (!raw || typeof raw !== 'object') throw new Error(`Object ${index + 1} is invalid.`);
	const type = OBJECT_ENUMS.type.includes(raw.type) ? raw.type : null;
	if (!type) throw new Error(`Object ${index + 1} has an unsupported type.`);
	const pos = vector(raw.pos, 10000);
	const rot = vector(raw.rot, 3600);
	if (!pos || !rot) throw new Error(`Object ${index + 1} has an invalid position or rotation.`);
	const object = { id: Number.isInteger(raw.id) && raw.id > 0 ? raw.id : null, type, pos, rot };
	if (typeof raw.text === 'string') object.text = raw.text.slice(0, 256);
	if (typeof raw.mirror === 'boolean') object.mirror = raw.mirror;
	for (const [key, limits] of Object.entries(OBJECT_NUMBERS)) {
		const value = number(raw[key], limits, INTEGER_KEYS.has(key));
		if (value !== undefined) object[key] = value;
	}
	for (const [key, allowed] of Object.entries(OBJECT_ENUMS)) {
		if (key !== 'type' && allowed.includes(raw[key])) object[key] = raw[key];
	}
	object.face ??= 'auto';
	if (type === 'image') {
		if (typeof raw.image !== 'string' || !IMAGE_DATA_URL.test(raw.image)) throw new Error(`Image object ${index + 1} has invalid image data.`);
		object.image = raw.image;
	}
	if (type === 'svg') {
		if (typeof raw.svg !== 'string' || raw.svg.length > MAX_SVG_BYTES) throw new Error(`SVG object ${index + 1} has invalid SVG data.`);
		object.svg = raw.svg;
	}
	return object;
}

/**
 * Parses untrusted project JSON into settings: every value is type-checked,
 * clamped or whitelisted, and missing values fall back to `defaults`.
 */
export function parseProject(text, defaults) {
	if (typeof text !== 'string' || text.length > MAX_PROJECT_BYTES) throw new Error('Project file is too large.');
	let data;
	try { data = JSON.parse(text); } catch { throw new Error('Project file is not valid JSON.'); }
	if (!data || data.app !== PROJECT_APP || !data.settings || typeof data.settings !== 'object') throw new Error('Not a Simple 3D project file.');
	if (!Number.isInteger(data.version) || data.version > PROJECT_VERSION) throw new Error('Project was saved by a newer version of Simple 3D.');
	const raw = data.settings;
	const settings = { ...defaults };
	for (const [key, limits] of Object.entries(SETTINGS_NUMBERS)) {
		const value = number(raw[key], limits, INTEGER_KEYS.has(key));
		if (value !== undefined) settings[key] = value;
	}
	for (const key of SETTINGS_BOOLEANS) if (typeof raw[key] === 'boolean') settings[key] = raw[key];
	if (ids(BASE_SHAPES).includes(raw.baseShape)) settings.baseShape = raw.baseShape;
	if (['raised', 'inset', 'flush_inlay'].includes(raw.mode)) settings.mode = raw.mode;
	if (ids(FONTS).includes(raw.font)) settings.font = raw.font;
	if (!Array.isArray(raw.objects)) throw new Error('Project has no object list.');
	if (raw.objects.length > MAX_OBJECTS) throw new Error(`Projects are limited to ${MAX_OBJECTS} objects.`);
	const used = new Set();
	let maxId = 0;
	const objects = raw.objects.map(sanitizeObject);
	for (const object of objects) if (object.id && !used.has(object.id)) { used.add(object.id); maxId = Math.max(maxId, object.id); } else object.id = null;
	for (const object of objects) if (!object.id) object.id = ++maxId;
	settings.objects = objects;
	return { settings, maxId };
}
