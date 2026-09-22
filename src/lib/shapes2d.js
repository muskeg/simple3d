import * as THREE from 'three';
import { roundedRectShape } from './geometry.js';

export const SHAPE_KINDS = [
	{ id: 'circle', label: 'Circle' },
	{ id: 'rect', label: 'Rectangle' },
	{ id: 'star', label: 'Star' },
	{ id: 'heart', label: 'Heart' },
	{ id: 'polygon', label: 'Polygon' },
	{ id: 'arrow', label: 'Arrow' },
];

function polygonShape(points) {
	return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

function radialPoints(count, radiusAt) {
	return Array.from({ length: count }, (_, k) => {
		const angle = Math.PI / 2 + (2 * Math.PI * k) / count;
		const radius = radiusAt(k);
		return [radius * Math.cos(angle), radius * Math.sin(angle)];
	});
}

function outline(object, w, h) {
	const sides = Math.max(3, Math.min(24, Math.round(object.sides ?? 5)));
	switch (object.shape) {
		case 'rect': return roundedRectShape(w, h, Math.max(0, Math.min(object.cornerRadius ?? 0, w / 2, h / 2)));
		case 'star': {
			const inner = Math.max(0.1, Math.min(0.95, object.innerRatio ?? 0.5));
			return polygonShape(radialPoints(sides * 2, (k) => (k % 2 ? inner : 1)));
		}
		case 'polygon': return polygonShape(radialPoints(sides, () => 1));
		case 'heart': {
			const shape = new THREE.Shape();
			shape.moveTo(0, -1);
			shape.bezierCurveTo(-0.6, -0.45, -1, -0.1, -1, 0.35);
			shape.bezierCurveTo(-1, 0.8, -0.45, 1.05, 0, 0.6);
			shape.bezierCurveTo(0.45, 1.05, 1, 0.8, 1, 0.35);
			shape.bezierCurveTo(1, -0.1, 0.6, -0.45, 0, -1);
			return shape;
		}
		case 'arrow': return polygonShape([[-1, -0.2], [0.3, -0.2], [0.3, -0.5], [1, 0], [0.3, 0.5], [0.3, 0.2], [-1, 0.2]]);
		case 'circle':
		default: {
			const shape = new THREE.Shape();
			shape.absarc(0, 0, 1, 0, Math.PI * 2, false);
			return shape;
		}
	}
}

/**
 * Unit-prism geometry (flat on XZ, extrusion +Y, height 1, centered) whose
 * footprint is exactly fontSize (width) x shapeHeight millimeters.
 */
export function createShapeGeometry(object) {
	const w = Math.max(0.5, object.fontSize ?? 20);
	const h = Math.max(0.5, object.shapeHeight ?? w);
	const geometry = new THREE.ExtrudeGeometry(outline(object, w, h), { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 24 });
	geometry.computeBoundingBox();
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	geometry.center();
	geometry.scale(w / size.x, h / size.y, 1);
	geometry.rotateX(-Math.PI / 2);
	geometry.computeVertexNormals();
	return geometry;
}
