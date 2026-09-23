import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { getEngine, withTracking } from './engine.js';
import { encodeMesh } from './meshData.js';

export const MESH_ACCEPT = '.stl,.obj,.3mf,model/stl,model/obj,model/3mf';
export const MAX_MESH_BYTES = 25 * 1024 * 1024;
export const MAX_MESH_TRIANGLES = 500000;
export const DENSE_MESH_TRIANGLES = 200000;
const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const NOT_SOLID = 'The mesh is not a closed solid (it has holes, open edges or non-manifold geometry). Repair it, for example in your slicer or Meshmixer, and try again.';

/** World-space triangle soup of every mesh under `root`. */
function trianglePositions(root) {
	root.updateMatrixWorld(true);
	const chunks = [];
	root.traverse((node) => {
		if (!node.isMesh || !node.geometry?.attributes.position) return;
		const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
		geometry.applyMatrix4(node.matrixWorld);
		chunks.push(geometry.attributes.position.array);
		geometry.dispose();
	});
	const positions = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) { positions.set(chunk, offset); offset += chunk.length; }
	return positions;
}

function threeMFUnit(buffer) {
	const files = unzipSync(new Uint8Array(buffer), { filter: (file) => /\.model$/i.test(file.name) });
	const model = Object.values(files)[0];
	const unit = model && /<model[^>]*\sunit="([a-z]+)"/i.exec(strFromU8(model))?.[1];
	return UNIT_MM[unit?.toLowerCase()] ?? 1;
}

function readTriangles(name, buffer) {
	const extension = name.split('.').pop().toLowerCase();
	if (extension === 'stl') return { positions: trianglePositions(new THREE.Mesh(new STLLoader().parse(buffer))), zUp: true, scale: 1 };
	if (extension === 'obj') return { positions: trianglePositions(new OBJLoader().parse(new TextDecoder().decode(buffer))), zUp: false, scale: 1 };
	if (extension === '3mf') return { positions: trianglePositions(new ThreeMFLoader().parse(buffer)), zUp: true, scale: threeMFUnit(buffer) };
	throw new Error('Choose an STL, OBJ or 3MF file.');
}

function flipped(manifold) {
	const { Manifold, Mesh } = getEngine();
	const mesh = manifold.getMesh();
	const triVerts = mesh.triVerts.slice();
	for (let index = 0; index < triVerts.length; index += 3) [triVerts[index + 1], triVerts[index + 2]] = [triVerts[index + 2], triVerts[index + 1]];
	return new Manifold(new Mesh({ numProp: mesh.numProp, vertProperties: mesh.vertProperties, triVerts }));
}

/**
 * Parses an STL/OBJ/3MF file into a validated mesh record. STL and 3MF are
 * treated as Z-up print files and converted to the editor's Y-up; OBJ is
 * taken as Y-up. 3MF units are converted to mm. Duplicate vertices are
 * merged, an inside-out mesh is flipped, overlapping parts are unioned and
 * inward-facing shells become cavities. Open or non-manifold meshes throw.
 */
export function loadMeshFile(name, buffer, { maxTriangles = MAX_MESH_TRIANGLES } = {}) {
	if (buffer.byteLength > MAX_MESH_BYTES) throw new Error('Mesh file exceeds the 25 MB limit.');
	let read;
	try { read = readTriangles(name, buffer); } catch (error) {
		throw error.message?.startsWith('Choose') ? error : new Error(`Unable to read ${name.split('.').pop().toUpperCase()} file.`);
	}
	const { positions, zUp, scale } = read;
	const count = positions.length / 9;
	if (!count) throw new Error('The file contains no triangles.');
	if (count > maxTriangles) throw new Error(`The mesh has ${count.toLocaleString('en-US')} triangles; the limit is ${maxTriangles.toLocaleString('en-US')}.`);
	for (let index = 0; index < positions.length; index += 3) {
		const [x, y, z] = [positions[index], positions[index + 1], positions[index + 2]];
		positions.set(zUp ? [x * scale, z * scale, -y * scale] : [x * scale, y * scale, z * scale], index);
	}
	if (!positions.every(Number.isFinite)) throw new Error('The mesh contains invalid coordinates.');
	const { Manifold, Mesh } = getEngine();
	return withTracking((track) => {
		const input = new Mesh({ numProp: 3, vertProperties: positions, triVerts: Uint32Array.from({ length: count * 3 }, (_, index) => index) });
		input.merge();
		let solid;
		try { solid = track(new Manifold(input)); } catch { throw new Error(NOT_SOLID); }
		if (solid.status() !== 'NoError') throw new Error(NOT_SOLID);
		if (solid.volume() < 0) solid = track(flipped(solid));
		const parts = solid.decompose().map(track);
		const outer = parts.filter((part) => part.volume() > 0);
		const cavities = parts.filter((part) => part.volume() < 0).map((part) => track(flipped(part)));
		let result = outer.length > 1 ? track(Manifold.union(outer)) : outer[0] ?? solid;
		if (cavities.length) result = track(result.subtract(track(Manifold.union(cavities))));
		if (result.isEmpty() || !(result.volume() > 1e-9)) throw new Error('The mesh has no volume.');
		const mesh = result.getMesh();
		const vertexCount = mesh.vertProperties.length / mesh.numProp;
		const out = new Float32Array(vertexCount * 3);
		for (let vertex = 0; vertex < vertexCount; vertex++) out.set(mesh.vertProperties.subarray(vertex * mesh.numProp, vertex * mesh.numProp + 3), vertex * 3);
		return encodeMesh(name, out, new Uint32Array(mesh.triVerts));
	});
}
