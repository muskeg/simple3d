import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { maskGeometryFromPixels } from '../src/lib/mask.js';

function pixels(width, height, predicate) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let vertical = 0; vertical < height; vertical++) {
		for (let horizontal = 0; horizontal < width; horizontal++) {
			data.set(predicate(horizontal, vertical), (vertical * width + horizontal) * 4);
		}
	}
	return data;
}
const options = { fontSize: 40, threshold: 128 };

test('transparent mask stays empty including threshold zero', () => {
	const data = new Uint8ClampedArray(64);
	assert.equal(maskGeometryFromPixels(data, 4, 4, options), null);
	assert.equal(maskGeometryFromPixels(data, 4, 4, { ...options, threshold: 0 }), null);
});

test('mask preserves holes, disconnected islands and unit height', () => {
	const data = pixels(16, 16, (horizontal, vertical) => [20, 80, 160, horizontal >= 1 && horizontal <= 9 && vertical >= 1 && vertical <= 9 && !(horizontal >= 4 && horizontal <= 6 && vertical >= 4 && vertical <= 6) || horizontal >= 12 && vertical >= 12 ? 255 : 0]);
	const geometry = maskGeometryFromPixels(data, 16, 16, options);
	assert.equal(geometry.parameters.shapes.length, 2);
	assert.equal(geometry.parameters.shapes.reduce((count, shape) => count + shape.holes.length, 0), 1);
	geometry.computeBoundingBox();
	assert.equal(geometry.boundingBox.getSize(new THREE.Vector3()).y, 1);
	assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
	geometry.dispose();
});

test('dark and light channels distinguish opaque black and white', () => {
	const data = pixels(8, 8, (horizontal) => horizontal < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
	for (const channel of ['dark', 'light']) {
		const geometry = maskGeometryFromPixels(data, 8, 8, { ...options, maskChannel: channel });
		geometry.computeBoundingBox();
		assert.equal(geometry.boundingBox.getSize(new THREE.Vector3()).x, 20);
		assert.ok(channel === 'dark' ? geometry.boundingBox.max.x <= 0 : geometry.boundingBox.min.x >= 0);
		geometry.dispose();
	}
});