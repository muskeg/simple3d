import * as THREE from 'three';
import { createBaseGeometry as createBoxGeometry, roundedRectShape } from './geometry.js';

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
 *   ngon     : regular polygon prism (flat front edge) scaled to W x D
 *   tube     : elliptical ring W x D with a wall thickness, H tall
 *   torus    : ring lying flat, W x D footprint, H thick
 */
export const BASE_SHAPES = [
	{ id: 'box', label: 'Box' },
	{ id: 'cylinder', label: 'Cylinder' },
	{ id: 'sphere', label: 'Sphere' },
	{ id: 'cone', label: 'Cone' },
	{ id: 'pyramid', label: 'Pyramid' },
	{ id: 'ngon', label: 'N-gon' },
	{ id: 'tube', label: 'Tube' },
	{ id: 'torus', label: 'Torus' },
];

// Prism shapes whose footprint can be offset for hollow shells and lids.
export const SHELL_SHAPES = ['box', 'cylinder', 'ngon'];

function ngonPoints(sides, w, d) {
	const n = Math.max(3, Math.min(12, Math.round(sides || 6)));
	const start = -Math.PI / 2 + Math.PI / n;
	const raw = Array.from({ length: n }, (_, k) => [Math.cos(start + (2 * Math.PI * k) / n), Math.sin(start + (2 * Math.PI * k) / n)]);
	const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
	const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	return raw.map(([x, y]) => [((x - minX) / (maxX - minX) - 0.5) * w, ((y - minY) / (maxY - minY) - 0.5) * d]);
}

function ellipsePoints(w, d, segments) {
	return Array.from({ length: segments }, (_, k) => [(w / 2) * Math.cos((2 * Math.PI * k) / segments), (d / 2) * Math.sin((2 * Math.PI * k) / segments)]);
}

/**
 * Counter-clockwise outline of a prism base in extrusion-shape coordinates
 * (x, y), where shape +y maps to world -z. Only defined for SHELL_SHAPES.
 */
export function baseFootprint(settings) {
	const w = Math.max(0.1, settings.width);
	const d = Math.max(0.1, settings.depth);
	const radial = Math.max(8, Math.round(settings.radialSegments || 64));
	if (settings.baseShape === 'cylinder') return ellipsePoints(w, d, radial);
	if (settings.baseShape === 'ngon') return ngonPoints(settings.sides, w, d);
	const r = Math.max(0, Math.min(settings.cornerRadius || 0, w / 2, d / 2));
	return roundedRectShape(w, d, r).extractPoints(Math.min(64, Math.max(4, Math.round(r / 0.25) || 12))).shape.map((p) => [p.x, p.y]);
}

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

		case 'ngon': {
			const points = ngonPoints(settings.sides, w, d);
			const apothem = Math.min(w, d) / 2 * Math.cos(Math.PI / points.length);
			const c = Math.min(Math.max(0, settings.chamfer || 0), apothem * 0.9, (h / 2) * 0.9);
			const geom = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), {
				depth: Math.max(0.01, h - 2 * c),
				bevelEnabled: c > 0.001,
				bevelThickness: c,
				bevelSize: c,
				bevelOffset: -c,
				bevelSegments: Math.max(1, Math.round(settings.chamferSegments || 1)),
				steps: 1,
			});
			geom.rotateX(-Math.PI / 2);
			geom.center();
			return geom;
		}

		case 'tube': {
			const wall = Math.max(0.1, Math.min(settings.tubeWall ?? 3, Math.min(w, d) / 2 - 0.05));
			const toVectors = (points) => points.map(([x, y]) => new THREE.Vector2(x, y));
			const shape = new THREE.Shape(toVectors(ellipsePoints(w, d, radial)));
			shape.holes = [new THREE.Path(toVectors(ellipsePoints(w - 2 * wall, d - 2 * wall, radial)))];
			const geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
			geom.rotateX(-Math.PI / 2);
			geom.center();
			return geom;
		}

		case 'torus': {
			// Tube radius from H; ring radius keeps a visible hole before the exact W/H/D rescale.
			const tube = h / 2;
			const ring = Math.max(Math.min(w, d) / 2 - tube, tube * 1.2);
			const geom = new THREE.TorusGeometry(ring, tube, Math.max(8, Math.round(radial / 2)), radial);
			geom.rotateX(-Math.PI / 2);
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
