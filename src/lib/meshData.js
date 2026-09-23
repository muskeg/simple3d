import * as THREE from 'three';
import { bufferToBase64 } from './fonts.js';

/**
 * Stored mesh record: { name, vertices, triangles, size, triangleCount }.
 * `vertices` is base64 of little-endian Float32 xyz triples (editor Y-up, mm,
 * centered on the bounding box); `triangles` is base64 of Uint32 index
 * triples with outward (counter-clockwise) winding; `size` is the native
 * bounding-box size. Decoded geometry is cached and borrowed: clone before
 * mutating or disposing it.
 */
const cache = new Map();
const MAX_CACHE = 8;

function bytesFromBase64(base64) {
	return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function encodeMesh(name, positions, indices) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.computeBoundingBox();
	const center = geometry.boundingBox.getCenter(new THREE.Vector3());
	const size = geometry.boundingBox.getSize(new THREE.Vector3());
	for (let index = 0; index < positions.length; index += 3) {
		positions[index] -= center.x;
		positions[index + 1] -= center.y;
		positions[index + 2] -= center.z;
	}
	geometry.dispose();
	return {
		name: String(name).slice(0, 128),
		vertices: bufferToBase64(positions.buffer),
		triangles: bufferToBase64(indices.buffer),
		size: { x: size.x, y: size.y, z: size.z },
		triangleCount: indices.length / 3,
	};
}

/** Borrowed indexed geometry for a mesh record; throws if the data is malformed. */
export function decodeMesh(record) {
	const cached = cache.get(record?.vertices);
	if (cached && cached.triangles === record.triangles) return cached.geometry;
	let positions, indices;
	try {
		const vertexBytes = bytesFromBase64(record.vertices);
		const triangleBytes = bytesFromBase64(record.triangles);
		if (vertexBytes.length % 12 || triangleBytes.length % 12 || !vertexBytes.length || !triangleBytes.length) throw new Error();
		positions = new Float32Array(vertexBytes.buffer);
		indices = new Uint32Array(triangleBytes.buffer);
	} catch {
		throw new Error('Mesh data is invalid.');
	}
	const vertexCount = positions.length / 3;
	if (!positions.every(Number.isFinite) || !indices.every((index) => index < vertexCount)) throw new Error('Mesh data is invalid.');
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	cache.get(record.vertices)?.geometry.dispose();
	cache.set(record.vertices, { triangles: record.triangles, geometry });
	if (cache.size > MAX_CACHE) {
		const oldest = cache.keys().next().value;
		cache.get(oldest).geometry.dispose();
		cache.delete(oldest);
	}
	return geometry;
}

/** A new record rotated 90° about a world axis (right-handed), re-centered. */
export function rotateMesh(record, axis) {
	const source = decodeMesh(record);
	const positions = source.attributes.position.array.slice();
	for (let index = 0; index < positions.length; index += 3) {
		const [x, y, z] = [positions[index], positions[index + 1], positions[index + 2]];
		const rotated = axis === 'x' ? [x, -z, y] : axis === 'y' ? [z, y, -x] : [-y, x, z];
		positions.set(rotated, index);
	}
	return encodeMesh(record.name, positions, source.index.array.slice());
}

/** Owned copy of a mesh object's geometry: uniformly scaled to `fontSize` mm wide, centered on X/Z, bottom at Y=0. */
export function meshObjectGeometry(object) {
	const geometry = decodeMesh(object.mesh).clone();
	const scale = Math.max(0.1, object.fontSize ?? object.mesh.size.x) / Math.max(1e-6, object.mesh.size.x);
	geometry.scale(scale, scale, scale);
	geometry.computeBoundingBox();
	geometry.translate(0, -geometry.boundingBox.min.y, 0);
	geometry.computeBoundingBox();
	return geometry;
}
