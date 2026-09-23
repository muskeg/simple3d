import * as THREE from 'three';
import { getEngine, solidToGeometry, withTracking, Z_TO_Y_ARRAY } from './engine.js';

/** Counter-clockwise rounded rectangle centered on the origin. */
export function roundedRectShape(w, d, r) {
	const shape = new THREE.Shape();
	const hw = w / 2;
	const hd = d / 2;
	if (r <= 0) {
		shape.moveTo(-hw, -hd);
		shape.lineTo(hw, -hd);
		shape.lineTo(hw, hd);
		shape.lineTo(-hw, hd);
		shape.closePath();
		return shape;
	}
	shape.moveTo(-hw + r, -hd);
	shape.lineTo(hw - r, -hd);
	shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
	shape.lineTo(hw, hd - r);
	shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
	shape.lineTo(-hw + r, hd);
	shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
	shape.lineTo(-hw, -hd + r);
	shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
	return shape;
}

/**
 * Builds the base plate geometry.
 *
 * A rounded-rectangle Shape is extruded along Y, centered on the origin so
 * the plate spans exactly -W/2..W/2, -D/2..D/2, -H/2..H/2.
 *
 * EXACT DIMENSIONS: the bevels are retracted inward with
 * `bevelOffset = -bevelSize` and the core depth reduced to `h - 2c`, so the
 * bounding box is EXACTLY width x depth x height, chamfer included (top
 * and bottom faces sit on the full shape outline; the chamfer cuts inward
 * from there). Verified empirically against the computed bounding box.
 */
export function createBaseGeometry({ width, depth, height, cornerRadius, chamfer, chamferSegments }) {
	const w = Math.max(0.1, width);
	const d = Math.max(0.1, depth);
	const h = Math.max(0.1, height);

	// Keep the corner radius inside the footprint.
	const r = Math.max(0, Math.min(cornerRadius || 0, w / 2, d / 2));
	const c = Math.min(Math.max(0, chamfer || 0), (Math.min(w, d) / 2) * 0.9, (h / 2) * 0.9);

	const shape = roundedRectShape(w, d, r);
	const segments = Math.max(1, Math.round(chamferSegments || 1));

	const options = {
		depth: Math.max(0.01, h - 2 * c), // core depth; bevels add c on each end
		bevelEnabled: c > 0.001,
		bevelThickness: c,
		bevelSize: c,
		bevelOffset: -c, // retract bevel inward -> bounding box == nominal size
		bevelSegments: segments,
		curveSegments: Math.min(64, Math.max(4, Math.round(r / 0.25) || 12)),
		steps: 1,
	};

	const geom = new THREE.ExtrudeGeometry(shape, options);

	// ExtrudeGeometry lays the shape in the XY plane and extrudes along +Z.
	// Rotate so the extrusion axis is +Y, then center on the origin.
	geom.rotateX(-Math.PI / 2);
	geom.center();
	geom.computeVertexNormals();
	return geom;
}

/**
 * Builds a text geometry as a UNIT PRISM: flat side on local XZ, extrusion
 * toward local +Y, centered on the origin, height exactly 1.
 *
 * Lines split on "\n" and are aligned left/center/right within the widest
 * line. letterSpacing (mm) is added after each glyph advance; lineHeight
 * scales the typeface line advance. Glyph outlines are unioned in 2D, so
 * tight spacing or self-overlapping glyphs still produce one valid solid.
 *
 * The object's world height (extrudeHeight) is applied by the CSG pipeline
 * as a Y-scale on the brush, so the extrusion axis (and therefore the
 * inset/flush depth through the base) always follows the object's
 * orientation.
 */
export function createTextGeometry(text, font, { fontSize, curveSegments, align = 'center', letterSpacing = 0, lineHeight = 1 }) {
	const lines = String(text ?? '').replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+$/, ''));
	while (lines.length && !lines[0].trim()) lines.shift();
	while (lines.length && !lines.at(-1).trim()) lines.pop();
	if (!lines.length || !font?.data) return null;
	const data = font.data;
	const size = Math.max(0.5, fontSize);
	const scale = size / data.resolution;
	const advance = (data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness) * scale * Math.max(0.1, lineHeight ?? 1);
	const spacing = Number.isFinite(letterSpacing) ? letterSpacing : 0;
	const segments = Math.max(2, Math.round(curveSegments || 8));
	const rows = lines.map((line, row) => {
		const glyphs = [];
		let x = 0;
		for (const char of line) {
			const key = data.glyphs[char] ? char : '?';
			const glyph = data.glyphs[key];
			if (!glyph) continue;
			glyphs.push({ key, x });
			x += glyph.ha * scale + spacing;
		}
		return { glyphs, width: Math.max(0, x - spacing), y: -row * advance };
	});
	const widest = Math.max(...rows.map((row) => row.width));
	const { CrossSection } = getEngine();
	try {
		return withTracking((track) => {
			const sections = [];
			for (const row of rows) {
				const shift = align === 'left' ? 0 : align === 'right' ? widest - row.width : (widest - row.width) / 2;
				for (const { key, x } of row.glyphs) {
					for (const shape of font.generateShapes(key, size)) {
						const { shape: outer, holes } = shape.extractPoints(segments);
						const rings = [outer, ...holes].filter((ring) => ring.length >= 3).map((ring) => ring.map((point) => [point.x + x + shift, point.y + row.y]));
						if (rings.length) sections.push(track(new CrossSection(rings, 'EvenOdd')));
					}
				}
			}
			if (!sections.length) return null;
			const merged = track(CrossSection.union(sections));
			if (merged.isEmpty()) return null;
			const geometry = solidToGeometry(track(track(merged.extrude(1)).transform(Z_TO_Y_ARRAY)));
			geometry.center();
			return geometry;
		});
	} catch (err) {
		throw new Error(`Unable to build text: ${err.message}`);
	}
}
