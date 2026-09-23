import { BASE_SHAPES } from './baseShapes.js';
import { FONTS, CUSTOM_FONT_ID, MAX_FONT_BYTES } from './fonts.js';
import { FACES } from './placement.js';
import { SHAPE_KINDS } from './shapes2d.js';
import { OBJECT_MODES, HOLE_HEADS, HOLE_DEPTHS } from './objects.js';
import { MAX_SVG_BYTES } from './svg.js';
import { ARRAY_KINDS } from './arrays.js';
import { MAX_MESH_TRIANGLES } from './meshImport.js';

export const PROJECT_APP = 'simple3d';
export const PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const MAX_OBJECTS = 200;

const SETTINGS_NUMBERS = {
	width: [0.1, 800], depth: [0.1, 800], height: [0.1, 400], cornerRadius: [0, 400], chamfer: [0, 100],
	chamferSegments: [1, 16], radialSegments: [8, 128], sides: [3, 12], tubeWall: [0.2, 100], wall: [0.4, 50],
	lidThickness: [0.4, 50], lipDepth: [0, 100], lidClearance: [0, 2], insetDepth: [0.1, 100],
};
const SETTINGS_BOOLEANS = ['shell', 'openTop', 'lid', 'meshLock'];
const OBJECT_NUMBERS = {
	fontSize: [0.5, 300], curveSegments: [2, 32], extrudeHeight: [0.05, 200], inlayDepth: [0.1, 100], insetDepth: [0.1, 100],
	threshold: [1, 255], maskResolution: [32, 1024], shapeHeight: [0.5, 300], sides: [3, 24], innerRatio: [0.1, 0.95],
	cornerRadius: [0, 150], holeDiameter: [0.2, 200], headDiameter: [0.2, 300], headDepth: [0.1, 100], holeDepth: [0.1, 1000],
	letterSpacing: [-50, 100], lineHeight: [0.5, 3],
	arrayCount: [1, 400], arrayRows: [1, 400], arraySpacing: [-1000, 1000], arrayRowSpacing: [-1000, 1000], arrayRadius: [0.1, 1000], arraySweep: [1, 360],
};
export const MAX_TEXT_LENGTH = 1000;
const MAX_CUSTOM_FONTS = 8;
const INTEGER_KEYS = new Set(['chamferSegments', 'radialSegments', 'sides', 'curveSegments', 'threshold', 'maskResolution', 'arrayCount', 'arrayRows']);
const ids = (list) => list.map((entry) => entry.id);
const OBJECT_ENUMS = {
	type: ['text', 'image', 'svg', 'shape', 'hole', 'mesh'],
	mode: ids(OBJECT_MODES),
	target: ['base', 'lid'],
	shape: ids(SHAPE_KINDS),
	head: ids(HOLE_HEADS),
	holeDepthMode: ids(HOLE_DEPTHS),
	maskChannel: ['alpha', 'dark', 'light'],
	face: FACES,
	align: ['left', 'center', 'right'],
	arrayKind: ids(ARRAY_KINDS),
};
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const BASE64 = /^[A-Za-z0-9+/=]+$/;
// Upper bound on base64 length for a mesh within the triangle limit (at most three vertices per triangle).
const MAX_MESH_BASE64 = Math.ceil((MAX_MESH_TRIANGLES * 3 * 12) / 3) * 4;

/** Type-checks a stored mesh record; its binary contents are verified when decoded. */
function sanitizeMesh(raw, what) {
	const size = vector(raw?.size, 100000);
	const triangleCount = number(raw?.triangleCount, [1, MAX_MESH_TRIANGLES], true);
	const valid = raw && typeof raw.name === 'string' && typeof raw.vertices === 'string' && typeof raw.triangles === 'string'
		&& raw.vertices.length <= MAX_MESH_BASE64 && raw.triangles.length <= MAX_MESH_BASE64 && BASE64.test(raw.vertices) && BASE64.test(raw.triangles)
		&& size && size.x > 0 && size.y > 0 && size.z > 0 && triangleCount !== undefined;
	if (!valid) throw new Error(`${what} has invalid mesh data.`);
	return { name: raw.name.slice(0, 128), vertices: raw.vertices, triangles: raw.triangles, size, triangleCount };
}

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

function sanitizeObject(raw, index, fontIds) {
	if (!raw || typeof raw !== 'object') throw new Error(`Object ${index + 1} is invalid.`);
	const type = OBJECT_ENUMS.type.includes(raw.type) ? raw.type : null;
	if (!type) throw new Error(`Object ${index + 1} has an unsupported type.`);
	const pos = vector(raw.pos, 10000);
	const rot = vector(raw.rot, 3600);
	if (!pos || !rot) throw new Error(`Object ${index + 1} has an invalid position or rotation.`);
	const object = { id: Number.isInteger(raw.id) && raw.id > 0 ? raw.id : null, type, pos, rot };
	if (typeof raw.text === 'string') object.text = raw.text.slice(0, MAX_TEXT_LENGTH);
	if (typeof raw.mirror === 'boolean') object.mirror = raw.mirror;
	if (typeof raw.arrayRotate === 'boolean') object.arrayRotate = raw.arrayRotate;
	for (const [key, limits] of Object.entries(OBJECT_NUMBERS)) {
		const value = number(raw[key], limits, INTEGER_KEYS.has(key));
		if (value !== undefined) object[key] = value;
	}
	for (const [key, allowed] of Object.entries(OBJECT_ENUMS)) {
		if (key !== 'type' && allowed.includes(raw[key])) object[key] = raw[key];
	}
	if (fontIds.includes(raw.font)) object.font = raw.font;
	object.face ??= 'auto';
	if (type === 'image') {
		if (typeof raw.image !== 'string' || !IMAGE_DATA_URL.test(raw.image)) throw new Error(`Image object ${index + 1} has invalid image data.`);
		object.image = raw.image;
	}
	if (type === 'svg') {
		if (typeof raw.svg !== 'string' || raw.svg.length > MAX_SVG_BYTES) throw new Error(`SVG object ${index + 1} has invalid SVG data.`);
		object.svg = raw.svg;
	}
	if (type === 'mesh') object.mesh = sanitizeMesh(raw.mesh, `Mesh object ${index + 1}`);
	return object;
}

function sanitizeFonts(raw) {
	if (!Array.isArray(raw) || raw.length > MAX_CUSTOM_FONTS) throw new Error(`Projects are limited to ${MAX_CUSTOM_FONTS} uploaded fonts.`);
	const seen = new Set();
	return raw.map((font, index) => {
		const valid = font && CUSTOM_FONT_ID.test(font.id) && !seen.has(font.id) && typeof font.label === 'string'
			&& typeof font.data === 'string' && font.data.length <= Math.ceil(MAX_FONT_BYTES / 3) * 4 && BASE64.test(font.data);
		if (!valid) throw new Error(`Uploaded font ${index + 1} is invalid.`);
		seen.add(font.id);
		return { id: font.id, label: font.label.slice(0, 64), data: font.data };
	});
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
	if (raw.customMesh) settings.customMesh = sanitizeMesh(raw.customMesh, 'The custom base');
	if (ids(BASE_SHAPES).includes(raw.baseShape) || (raw.baseShape === 'custom' && settings.customMesh)) settings.baseShape = raw.baseShape;
	if (['raised', 'inset', 'flush_inlay'].includes(raw.mode)) settings.mode = raw.mode;
	if (ids(FONTS).includes(raw.font)) settings.font = raw.font;
	if (raw.customFonts !== undefined) settings.customFonts = sanitizeFonts(raw.customFonts);
	const fontIds = [...ids(FONTS), ...ids(settings.customFonts || [])];
	if (!Array.isArray(raw.objects)) throw new Error('Project has no object list.');
	if (raw.objects.length > MAX_OBJECTS) throw new Error(`Projects are limited to ${MAX_OBJECTS} objects.`);
	const used = new Set();
	let maxId = 0;
	const objects = raw.objects.map((object, index) => sanitizeObject(object, index, fontIds));
	for (const object of objects) if (object.id && !used.has(object.id)) { used.add(object.id); maxId = Math.max(maxId, object.id); } else object.id = null;
	for (const object of objects) if (!object.id) object.id = ++maxId;
	settings.objects = objects;
	return { settings, maxId };
}
