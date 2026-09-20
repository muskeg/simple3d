import * as THREE from 'three';
import { createBaseGeometry as createBoxGeometry } from './geometry.js';

/**
 * Base shape library.
 *
 * Every shape is centered on the origin and sized so its bounding box
 * matches all three nominal dimensions, including bevels:
 *   box      : exactly W × H × D (rounded corners + chamfer included)
 *   cylinder : elliptical footprint W x D, exactly H tall
 *   sphere   : exactly W × H × D (ellipsoid)
 *   cone     : elliptical base W x D, exactly H tall
 *   pyramid  : rectangular base W x D, exactly H tall
 */
export const BASE_SHAPES = [
	{ id: 'box', label: 'Box' },
	{ id: 'cylinder', label: 'Cylinder' },
	{ id: 'sphere', label: 'Sphere' },
	{ id: 'cone', label: 'Cone' },
	{ id: 'pyramid', label: 'Pyramid' },
];

export function baseShapeMeta(id) {
	return BASE_SHAPES.find((s) => s.id === id) || BASE_SHAPES[0];
}

/**
 * Builds a centered base geometry for the given settings.
 * `settings` is the top-level settings object (uses baseShape, width, depth,
 * height, cornerRadius, chamfer, chamferSegments, radialSegments).
 */
function createRawGeometry(settings) {
	const w = Math.max(0.1, settings.width);
	const d = Math.max(0.1, settings.depth);
	const h = Math.max(0.1, settings.height);
	const radial = Math.max(8, Math.round(settings.radialSegments || 64));

	switch (settings.baseShape) {
		case 'cylinder': {
			// Same exact-dimension bevel math as the box: bevelOffset = -c
			// retracts the chamfer inward so the bounding box is exactly
			// Ø min(W,D) × H.
			const r = Math.min(w, d) / 2;
			const c = Math.min(
				Math.max(0, settings.chamfer || 0),
				r * 0.9,
				(h / 2) * 0.9,
			);

			const shape = new THREE.Shape();
			shape.absarc(0, 0, r, 0, Math.PI * 2, false);

			const geom = new THREE.ExtrudeGeometry(shape, {
				depth: Math.max(0.01, h - 2 * c),
				bevelEnabled: c > 0.001,
				bevelThickness: c,
				bevelSize: c,
				bevelOffset: -c,
				bevelSegments: Math.max(1, Math.round(settings.chamferSegments || 1)),
				curveSegments: radial,
				steps: 1,
			});
			geom.rotateX(-Math.PI / 2);
			geom.center();
			geom.computeVertexNormals();
			return geom;
		}

		case 'sphere': {
			// Unit sphere scaled to exactly W × H × D (ellipsoid).
			const geom = new THREE.SphereGeometry(1, radial, Math.max(4, radial / 2));
			geom.scale(w / 2, h / 2, d / 2);
			geom.computeVertexNormals();
			return geom;
		}

		case 'cone': {
			// Circular cone, base Ø min(W,D), height exactly H, centered so the
			// base sits at y=-H/2 and the apex at y=+H/2.
			const r = Math.min(w, d) / 2;
			const geom = new THREE.ConeGeometry(r, h, radial, 1);
			geom.computeVertexNormals();
			return geom;
		}

		case 'pyramid': {
			// 4-sided cone = square pyramid. Circumradius r gives a square of
			// side r*sqrt(2); choose r so the footprint side == min(W,D).
			const side = Math.min(w, d);
			const geom = new THREE.ConeGeometry(side / Math.SQRT2, h, 4, 1);
			geom.rotateY(Math.PI / 4); // square faces align with X/Z axes
			geom.computeVertexNormals();
			return geom;
		}

		case 'box':
		default:
			return createBoxGeometry(settings);
	}
}

export function createBaseGeometry(settings) {
	const geometry = createRawGeometry(settings);
	geometry.computeBoundingBox();
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	geometry.center();
	geometry.scale(
		Math.max(0.1, settings.width) / size.x,
		Math.max(0.1, settings.height) / size.y,
		Math.max(0.1, settings.depth) / size.z,
	);
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	return geometry;
}
