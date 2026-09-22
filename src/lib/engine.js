import * as THREE from 'three';
import ManifoldModule from 'manifold-3d';

let engine;
let enginePromise;

export function initGeometryEngine(wasmURL) {
	enginePromise ??= ManifoldModule(wasmURL ? { locateFile: () => wasmURL } : undefined).then((module) => {
		module.setup();
		engine = module;
		return module;
	});
	return enginePromise;
}

export function getEngine() {
	if (!engine) throw new Error('Geometry engine is not initialized.');
	return engine;
}

/** Converts a closed THREE geometry (optionally transformed) into a Manifold solid. */
export function toSolid(geometry, matrix = new THREE.Matrix4()) {
	const { Mesh, Manifold } = getEngine();
	const transformed = geometry.clone().applyMatrix4(matrix);
	try {
		const positions = transformed.attributes.position;
		const indices = transformed.index ? new Uint32Array(transformed.index.array) : Uint32Array.from({ length: positions.count }, (_, index) => index);
		const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(positions.array), triVerts: indices });
		mesh.merge();
		return new Manifold(mesh);
	} finally {
		transformed.dispose();
	}
}

/** Converts a Manifold solid into an indexed THREE geometry (the solid is not deleted). */
export function solidToGeometry(solid) {
	const data = solid.getMesh();
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.vertProperties), 3));
	geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.triVerts), 1));
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	return geometry;
}

// Manifold extrudes along +Z; the editor extrudes along +Y with 2D +Y mapped to -Z (same as THREE.ExtrudeGeometry + rotateX(-90°)).
export const Z_TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
export const Z_TO_Y_ARRAY = Array.from(Z_TO_Y.elements);

/** Runs `fn(track)` and deletes every tracked Manifold/CrossSection afterwards. */
export function withTracking(fn) {
	const tracked = [];
	const track = (value) => { tracked.push(value); return value; };
	try {
		return fn(track);
	} finally {
		for (const value of tracked) value.delete();
	}
}
