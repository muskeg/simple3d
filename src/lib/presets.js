import { facePlacementPreset } from './placement.js';

/**
 * Starting designs. `settings` overrides the app defaults; each object is
 * snapped to `face` of its `target` body and then shifted by `offset` (mm).
 */
export const PRESETS = [
	{
		id: 'keychain',
		label: 'Keychain tag',
		settings: { baseShape: 'box', width: 50, depth: 20, height: 4, cornerRadius: 10, chamfer: 0.8, chamferSegments: 1, mode: 'raised' },
		objects: [
			{ type: 'text', text: 'NAME', font: 'helvetiker_bold', fontSize: 9, extrudeHeight: 1.5, offset: { x: 5 } },
			{ type: 'hole', holeDiameter: 4, offset: { x: -18 } },
		],
	},
	{
		id: 'nameplate',
		label: 'Name plate',
		settings: { baseShape: 'box', width: 120, depth: 35, height: 5, cornerRadius: 4, chamfer: 1, chamferSegments: 1, mode: 'raised' },
		objects: [{ type: 'text', text: 'Your Name', font: 'helvetiker_bold', fontSize: 14, extrudeHeight: 2 }],
	},
	{
		id: 'coaster',
		label: 'Hex coaster',
		// Flat-to-flat depth of a regular hexagon is width x cos(30°).
		settings: { baseShape: 'ngon', sides: 6, width: 100, depth: 86.6, height: 5, chamfer: 1, chamferSegments: 1, mode: 'inset', insetDepth: 1 },
		objects: [{ type: 'text', text: 'Cheers', font: 'optimer', fontSize: 16 }],
	},
	{
		id: 'dice',
		label: 'Dice',
		settings: { baseShape: 'box', width: 16, depth: 16, height: 16, cornerRadius: 2, chamfer: 1, chamferSegments: 4, mode: 'flush_inlay' },
		objects: [['top', '1'], ['front', '2'], ['left', '3'], ['right', '4'], ['back', '5'], ['bottom', '6']].map(([face, text]) => ({ type: 'text', text, face, font: 'helvetiker_bold', fontSize: 9, inlayDepth: 0.8 })),
	},
	{
		id: 'stamp',
		label: 'Stamp',
		settings: { baseShape: 'box', width: 50, depth: 50, height: 15, cornerRadius: 3, chamfer: 0, mode: 'raised' },
		objects: [{ type: 'text', text: 'STAMP', font: 'helvetiker_bold', fontSize: 10, extrudeHeight: 2, mirror: true }],
	},
	{
		id: 'box',
		label: 'Box with lid',
		settings: { baseShape: 'box', width: 80, depth: 60, height: 40, cornerRadius: 6, chamfer: 0.8, chamferSegments: 1, shell: true, wall: 2, openTop: true, lid: true, lidThickness: 2.4, lipDepth: 4, lidClearance: 0.2, mode: 'raised' },
		objects: [
			{ type: 'text', text: 'BOX', target: 'lid', font: 'helvetiker_bold', fontSize: 16, extrudeHeight: 1 },
			{ type: 'text', text: 'Things', face: 'front', mode: 'inset', insetDepth: 0.6, fontSize: 10 },
		],
	},
	{
		id: 'sign',
		label: 'Wall sign',
		settings: { baseShape: 'box', width: 160, depth: 60, height: 4, cornerRadius: 8, chamfer: 1, chamferSegments: 1, mode: 'raised' },
		objects: [
			{ type: 'text', text: 'OPEN', font: 'helvetiker_bold', fontSize: 28, extrudeHeight: 2 },
			{ type: 'hole', holeDiameter: 4, head: 'countersink', headDiameter: 8, offset: { x: -70 } },
			{ type: 'hole', holeDiameter: 4, head: 'countersink', headDiameter: 8, offset: { x: 70 } },
		],
	},
];

/** Full settings for a preset; `makeObject(fields)` supplies ids and per-type defaults. */
export function presetSettings(id, defaults, makeObject) {
	const preset = PRESETS.find((entry) => entry.id === id);
	if (!preset) return null;
	const settings = { ...defaults, ...preset.settings, objects: [] };
	settings.objects = preset.objects.map(({ offset, face = 'top', ...object }) => {
		const placed = facePlacementPreset(face, settings, object.target === 'lid' ? 'lid' : 'base');
		const pos = offset ? { x: placed.pos.x + (offset.x ?? 0), y: placed.pos.y + (offset.y ?? 0), z: placed.pos.z + (offset.z ?? 0) } : placed.pos;
		// Offset objects are pinned ('auto') so later re-snaps don't pull them back to the face center.
		return makeObject({ font: settings.font, ...object, ...placed, pos, face: offset ? 'auto' : face });
	});
	return settings;
}
