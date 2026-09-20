import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

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

	const shape = new THREE.Shape();
	const hw = w / 2;
	const hd = d / 2;

	// Rounded rectangle path (counter-clockwise).
	if (r === 0) {
		shape.moveTo(-hw, -hd);
		shape.lineTo(hw, -hd);
		shape.lineTo(hw, hd);
		shape.lineTo(-hw, hd);
		shape.closePath();
	} else {
	shape.moveTo(-hw + r, -hd);
	shape.lineTo(hw - r, -hd);
	shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
	shape.lineTo(hw, hd - r);
	shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
	shape.lineTo(-hw + r, hd);
	shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
	shape.lineTo(-hw, -hd + r);
	shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
	}

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
 * The object's world height (extrudeHeight) is applied by the CSG pipeline
 * as a Y-scale on the brush, so the extrusion axis (and therefore the
 * inset/flush depth through the base) always follows the object's
 * orientation.
 */
export function createTextGeometry(text, font, { fontSize, curveSegments }) {
	const clean = (text ?? '').trim();
	if (!clean) return null;
	let geom;
	try {
		geom = new TextGeometry(clean, {
			font,
			size: Math.max(0.5, fontSize),
			depth: 1,
			curveSegments: Math.max(2, Math.round(curveSegments || 8)),
			bevelEnabled: false,
		});
	} catch (err) {
		throw new Error(`Unable to build text: ${err.message}`);
	}

	// Guard against empty geometry (missing glyphs).
	if (!geom.attributes.position || geom.attributes.position.count === 0) {
		geom.dispose();
		return null;
	}

	// TextGeometry is authored in the XY plane extruded toward +Z.
	// Rotate to the canonical orientation: +Z (extrusion) -> +Y (up).
	geom.rotateX(-Math.PI / 2);
	geom.center();
	geom.computeVertexNormals();
	return geom;
}
