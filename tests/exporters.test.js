import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import JSZip from 'jszip';
import { ThreeMFExporter, export3MF, exportSTL } from '../src/lib/exporters.js';

function fixture() {
	const group = new THREE.Group();
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 20), new THREE.MeshStandardMaterial());
	mesh.name = 'Base_Mesh';
	mesh.position.x = 5;
	group.add(mesh);
	return group;
}

test('3MF welds vertices and preserves transforms in a Z-up assembly', async () => {
	const group = fixture();
	const xml = ThreeMFExporter.serializeObject(group);
	assert.equal((xml.match(/<vertex /g) || []).length, 8);
	assert.equal((xml.match(/<triangle /g) || []).length, 12);
	assert.match(xml, /<vertex x="10.000000"/);
	assert.match(xml, /<components><component objectid="2"\/><\/components>/);
	assert.match(xml, /<build><item objectid="3"\/>/);
	assert.match(xml, /unit="millimeter"/);
	const zip = await JSZip.loadAsync(await (await export3MF(group)).arrayBuffer());
	assert.ok(zip.file('_rels/.rels'));
	assert.ok(zip.file('[Content_Types].xml'));
	assert.equal(await zip.file('3D/3dmodel.model').async('string'), xml);
});

test('STL is binary, transformed and Z-up without mutating the scene', () => {
	const group = fixture();
	const data = exportSTL(group);
	assert.equal(data.getUint32(80, true), 12);
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
	for (let triangle = 0; triangle < 12; triangle++) {
		for (let vertex = 0; vertex < 3; vertex++) {
			for (let axis = 0; axis < 3; axis++) {
				const value = data.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + axis * 4, true);
				min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
			}
		}
	}
	assert.deepEqual(max.map((value, index) => value - min[index]), [10, 20, 12]);
	assert.equal(min[0], 0);
	assert.equal(group.parent, null);
	assert.equal(group.rotation.x, 0);
});