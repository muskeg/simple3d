import * as THREE from 'three';
import { createBaseGeometry, baseFootprint, SHELL_SHAPES } from './baseShapes.js';
import { getEngine, toSolid, solidToGeometry, withTracking, Z_TO_Y_ARRAY } from './engine.js';

const PENETRATION = 0.05;
const LID_GAP = 10;

export function shellEnabled(settings) {
	return !!settings.shell && SHELL_SHAPES.includes(settings.baseShape);
}

export function lidEnabled(settings) {
	return shellEnabled(settings) && !!settings.openTop && !!settings.lid;
}

export function shellWall(settings) {
	return Math.max(0.2, Math.min(settings.wall ?? 2, Math.min(settings.width, settings.depth) / 2 - 0.1, settings.height - 0.1));
}

export function lipDepth(settings) {
	return Math.max(0, Math.min(settings.lipDepth ?? 4, settings.height - shellWall(settings) - 0.1));
}

/** Y of the lid plate's underside in the (floating) editor frame. */
export function lidOrigin(settings) {
	return settings.height / 2 + lipDepth(settings) + LID_GAP;
}

function extrudeY(section, height, bottom) {
	const raw = section.extrude(height);
	const rotated = raw.transform(Z_TO_Y_ARRAY);
	raw.delete();
	const moved = rotated.translate([0, bottom, 0]);
	rotated.delete();
	return moved;
}

/** Base body as a Manifold solid (caller owns it). */
export function createBaseSolid(settings) {
	const geometry = createBaseGeometry(settings);
	let solid;
	try { solid = toSolid(geometry); } finally { geometry.dispose(); }
	if (!shellEnabled(settings)) return solid;
	const { CrossSection } = getEngine();
	const wall = shellWall(settings);
	const bottom = -settings.height / 2 + wall;
	const top = settings.openTop ? settings.height / 2 + 1 : settings.height / 2 - wall;
	const cavity = withTracking((track) => {
		const inner = track(track(new CrossSection([baseFootprint(settings)], 'NonZero')).offset(-wall, 'Miter'));
		return inner.isEmpty() || top - bottom < 0.01 ? null : extrudeY(inner, top - bottom, bottom);
	});
	if (!cavity) return solid;
	try { return solid.subtract(cavity); } finally { cavity.delete(); solid.delete(); }
}

/** Lid body (plate + locating lip) as a Manifold solid, or null when disabled. */
export function createLidSolid(settings) {
	if (!lidEnabled(settings)) return null;
	const { CrossSection } = getEngine();
	return withTracking((track) => {
		const y0 = lidOrigin(settings);
		const outline = track(new CrossSection([baseFootprint(settings)], 'NonZero'));
		const plate = extrudeY(outline, Math.max(0.2, settings.lidThickness ?? 2), y0);
		const depth = lipDepth(settings);
		const lipSection = track(outline.offset(-(shellWall(settings) + Math.max(0, settings.lidClearance ?? 0.2)), 'Miter'));
		if (depth < 0.01 || lipSection.isEmpty()) return plate;
		track(plate);
		return plate.add(track(extrudeY(lipSection, depth + PENETRATION, y0 - depth)));
	});
}

/** THREE geometry of a body, used for face presets and surface snapping. */
export function createBodyGeometry(settings, target = 'base') {
	if (target === 'base' && !shellEnabled(settings)) return createBaseGeometry(settings);
	const solid = target === 'lid' ? createLidSolid(settings) : createBaseSolid(settings);
	if (!solid) return null;
	try { return solidToGeometry(solid); } finally { solid.delete(); }
}

/** Flips the lid upside down and parks it beside the base on the same floor. */
export function lidPrintMatrix(baseBounds, lidBounds) {
	const flip = new THREE.Matrix4().makeRotationX(Math.PI);
	const flipped = lidBounds.clone().applyMatrix4(flip);
	return new THREE.Matrix4().makeTranslation(baseBounds.max.x + LID_GAP - flipped.min.x, baseBounds.min.y - flipped.min.y, -(flipped.min.z + flipped.max.z) / 2).multiply(flip);
}
