import { getEngine, solidToGeometry, withTracking, Z_TO_Y_ARRAY } from './engine.js';
import { textSection } from './geometry.js';
import { baseFont } from './fonts.js';

/**
 * Text base: the base body is the typed text.
 *   flat     : letters lie on the bed, extruded up by the letter thickness
 *   standing : letters stand upright facing the front (+Z), extruded toward
 *              the viewer from an optional back panel, on an optional stand
 * The text sets the size, so width/height/depth are measured from it
 * (see applyBaseChange) rather than stretching the letters.
 */
export const TEXT_BASE_KEYS = [
	'baseText', 'baseFont', 'baseFontSize', 'baseLetterSpacing', 'baseLineHeight', 'baseTextAlign', 'baseTextWeight', 'baseTextOrientation', 'baseTextDepth',
	'baseBacking', 'baseBackingMargin', 'baseBackingHeight', 'baseStand', 'baseStandHeight', 'baseStandDepth', 'baseStandMargin', 'baseFloating', 'baseBridgeWidth',
];

export const BACKINGS = [
	{ id: 'none', label: 'None' },
	{ id: 'outline', label: 'Outline' },
	{ id: 'plate', label: 'Plate' },
];

export const TEXT_ORIENTATIONS = [
	{ id: 'flat', label: 'Flat' },
	{ id: 'standing', label: 'Standing' },
];

// What happens to parts of standing text that would float (dots on i/j, upper lines).
export const FLOATING_MODES = [
	{ id: 'connect', label: 'Connect' },
	{ id: 'remove', label: 'Remove' },
	{ id: 'keep', label: 'Keep' },
];

const standing = (settings) => settings.baseTextOrientation === 'standing';
const thickness = (settings) => Math.max(0.2, settings.baseTextDepth ?? 8);
const backingThickness = (settings) => Math.min(thickness(settings), Math.max(0.1, settings.baseBackingHeight ?? 2));
const standDepth = (settings) => Math.max(thickness(settings), settings.baseStandDepth ?? 20);

function rect(min, max, track) {
	return track(track(getEngine().CrossSection.square([max[0] - min[0], max[1] - min[1]])).translate(min));
}

/**
 * Standing letters without a backing: pieces that don't reach the ground are
 * dropped, or (lowest first) joined by a vertical bridge to the first solid
 * part below them, or to the ground when nothing is below.
 */
function anchorFloating(letters, ground, settings, track) {
	const mode = settings.baseFloating ?? 'connect';
	if (mode === 'keep') return letters;
	const { CrossSection } = getEngine();
	const pieces = letters.decompose().map(track);
	const floating = pieces.filter((piece) => piece.bounds().min[1] > ground + 1e-3).sort((a, b) => a.bounds().min[1] - b.bounds().min[1]);
	if (!floating.length) return letters;
	let support = track(CrossSection.union(pieces.filter((piece) => !floating.includes(piece))));
	if (mode === 'remove') return support;
	const width = Math.max(0.2, settings.baseBridgeWidth ?? 1.5);
	for (const piece of floating) {
		const { min, max } = piece.bounds();
		let x = (min[0] + max[0]) / 2;
		const column = track(rect([x - width / 2, min[1] - 1], [x + width / 2, max[1] + 1], track).intersect(piece));
		let low;
		if (column.isEmpty()) [x, low] = piece.toPolygons().flat().reduce((a, b) => (b[1] < a[1] ? b : a));
		else low = column.bounds().min[1];
		const hit = track(rect([x - width / 2, ground], [x + width / 2, low], track).intersect(support));
		// Overlap both ends by the bridge width so the joins are solid rather than touching.
		const bottom = hit.isEmpty() ? ground : Math.max(ground, hit.bounds().max[1] - width);
		const bridge = rect([x - width / 2, bottom], [x + width / 2, Math.min(max[1], low + width)], track);
		support = track(CrossSection.union([support, piece, bridge]));
	}
	return support;
}

/** 2D parts of the text base: letters, optional backing and (standing only) the stand profile. */
function profile(settings, track) {
	const text = textSection(settings.baseText, baseFont(settings), {
		fontSize: settings.baseFontSize ?? 30,
		curveSegments: 12,
		align: settings.baseTextAlign,
		letterSpacing: settings.baseLetterSpacing ?? 0,
		lineHeight: settings.baseLineHeight ?? 1,
	}, track);
	if (!text) return null;
	const weight = settings.baseTextWeight || 0;
	let letters = weight ? track(text.section.offset(weight, 'Round')) : text.section;
	if (letters.isEmpty()) return null;
	const margin = Math.max(0, settings.baseBackingMargin ?? 3);
	let backing = null;
	if (settings.baseBacking === 'outline') {
		backing = margin > 0 ? track(letters.offset(margin, 'Round')) : letters;
	} else if (settings.baseBacking === 'plate') {
		const { min, max } = letters.bounds();
		const box = rect(min, max, track);
		backing = margin > 0 ? track(box.offset(margin, 'Round')) : box;
	}
	if (!standing(settings)) return { letters, backing, stand: null };

	// Upright text needs a flat bottom: cut at the last baseline (moved by the weight and outline margin), so round letters stand; descenders are trimmed.
	const outer = (backing ?? letters).bounds();
	const ground = settings.baseBacking === 'plate' ? outer.min[1] : text.baseline - weight - (backing ? margin : 0);
	const keep = rect([outer.min[0] - 1, ground], [outer.max[0] + 1, outer.max[1] + 1], track);
	letters = track(letters.intersect(keep));
	if (!backing) letters = anchorFloating(letters, ground, settings, track);
	if (letters.isEmpty()) return null;
	if (backing) backing = track(backing.intersect(keep));
	let stand = null;
	if (settings.baseStand) {
		const { min, max } = (backing ?? letters).bounds();
		const overhang = Math.max(0, settings.baseStandMargin ?? 4);
		// Rises 0.05 mm into the letters: faces that only touch don't fuse into one solid.
		stand = rect([min[0] - overhang, ground - Math.max(0.2, settings.baseStandHeight ?? 4)], [max[0] + overhang, ground + 0.05], track);
	}
	return { letters, backing, stand };
}

/** Natural size of the text base in mm, or null when there is no text (or no font yet). */
export function measureTextBase(settings) {
	if (!baseFont(settings)) return null;
	return withTracking((track) => {
		const parts = profile(settings, track);
		if (!parts) return null;
		const boxes = [parts.letters, parts.backing, parts.stand].filter(Boolean).map((part) => part.bounds());
		const width = Math.max(...boxes.map((box) => box.max[0])) - Math.min(...boxes.map((box) => box.min[0]));
		const span = Math.max(...boxes.map((box) => box.max[1])) - Math.min(...boxes.map((box) => box.min[1]));
		if (!standing(settings)) return { width, depth: span, height: thickness(settings) };
		return { width, height: span, depth: parts.stand ? standDepth(settings) : thickness(settings) };
	});
}

/** Text base solid as a THREE geometry, or null when there is no text. */
export function createTextBaseGeometry(settings) {
	return withTracking((track) => {
		const parts = profile(settings, track);
		if (!parts) return null;
		const depth = thickness(settings);
		let solid = track(parts.letters.extrude(depth));
		if (parts.backing) solid = track(solid.add(track(parts.backing.extrude(backingThickness(settings)))));
		if (parts.stand) {
			const stand = track(track(parts.stand.extrude(standDepth(settings))).translate([0, 0, (depth - standDepth(settings)) / 2]));
			solid = track(solid.add(stand));
		}
		// Manifold extrudes along +Z, which is already upright and facing the front when standing.
		return solidToGeometry(standing(settings) ? solid : track(solid.transform(Z_TO_Y_ARRAY)));
	});
}

/**
 * Patch for editing one bounding-box dimension of a text base by `factor`:
 * the thickness axis (height when flat, depth when standing) scales the
 * thicknesses; the other two scale the lettering uniformly.
 */
export function scaleTextBase(settings, key, factor) {
	if (key === (standing(settings) ? 'depth' : 'height')) {
		return {
			baseTextDepth: thickness(settings) * factor,
			baseBackingHeight: (settings.baseBackingHeight ?? 2) * factor,
			baseStandDepth: (settings.baseStandDepth ?? 20) * factor,
		};
	}
	const size = settings.baseFontSize ?? 30;
	const baseFontSize = Math.min(500, Math.max(1, size * factor));
	const applied = baseFontSize / size;
	return {
		baseFontSize,
		baseLetterSpacing: (settings.baseLetterSpacing ?? 0) * applied,
		baseTextWeight: (settings.baseTextWeight ?? 0) * applied,
		baseBackingMargin: (settings.baseBackingMargin ?? 3) * applied,
		baseStandHeight: (settings.baseStandHeight ?? 4) * applied,
		baseStandMargin: (settings.baseStandMargin ?? 4) * applied,
		baseBridgeWidth: (settings.baseBridgeWidth ?? 1.5) * applied,
	};
}
