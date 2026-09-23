import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { makeTestFont } from '../fixtures/font.js';

async function ready(page) {
	await expect(page.getByRole('button', { name: 'Download .3MF', exact: true })).toBeEnabled();
	await expect(page.getByRole('alert')).toHaveCount(0);
}

async function tab(page, name) {
	await page.getByRole('tab', { name, exact: true }).click();
}

async function expand(page, name) {
	const toggle = page.getByRole('button', { name, exact: true });
	if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

async function fileMenu(page, item) {
	await page.getByRole('button', { name: 'File', exact: true }).click();
	await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function number(page, name, value) {
	const field = page.getByRole('textbox', { name, exact: true });
	await field.fill(String(value));
	await field.press('Enter');
	await ready(page);
}

async function stl(page) {
	return page.evaluate(async () => {
		const original = URL.createObjectURL;
		let captured;
		URL.createObjectURL = (blob) => { captured = blob; return original(blob); };
		try {
			[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Download .STL')).click();
			const data = new DataView(await captured.arrayBuffer());
			const triangles = data.getUint32(80, true);
			const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
			for (let triangle = 0; triangle < triangles; triangle++) {
				for (let vertex = 0; vertex < 3; vertex++) {
					for (let axis = 0; axis < 3; axis++) {
						const value = data.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + axis * 4, true);
						if (!Number.isFinite(value)) throw new Error('Invalid STL vertex');
						min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
					}
				}
			}
			return { triangles, min, max, size: max.map((value, index) => value - min[index]) };
		} finally { URL.createObjectURL = original; }
	});
}

async function modelXml(page) {
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .3MF', exact: true }).click();
	const zip = await JSZip.loadAsync(await readFile(await (await pending).path()));
	return zip.file('3D/3dmodel.model').async('string');
}

test.beforeEach(async ({ page }) => {
	page.on('pageerror', (error) => { throw error; });
	await page.goto('./');
	await ready(page);
});

test('numeric edits, cancellation, exact exported dimensions and empty base', async ({ page }) => {
	await page.getByRole('button', { name: 'Delete ABC', exact: true }).click();
	await ready(page);
	await expect(page.getByTestId('object-row')).toHaveCount(0);
	await tab(page, 'Base');
	await number(page, 'Width', 1200.125);
	await number(page, 'Height', 18.25);
	const field = page.getByRole('textbox', { name: 'Width', exact: true });
	await field.fill('900'); await field.press('Escape');
	await expect(field).toHaveValue('1200.125');
	await field.fill('12oops'); await field.press('Enter');
	await expect(field).toHaveValue('1200.125');
	await field.fill('Infinity'); await field.press('Enter');
	await expect(field).toHaveValue('1200.125');
	for (const shape of ['Box', 'Cylinder', 'Sphere', 'Cone', 'Pyramid', 'N-gon', 'Tube', 'Torus']) {
		await page.getByRole('button', { name: shape, exact: true }).click();
		await ready(page);
		const mesh = await stl(page);
		expect(mesh.size[0]).toBeCloseTo(1200.125, 3);
		expect(mesh.size[1]).toBeCloseTo(60, 3);
		expect(mesh.size[2]).toBeCloseTo(18.25, 3);
	}
});

test('independent fonts, object lifecycle, rotations, modes and exports', async ({ page }) => {
	const baseline = await stl(page);
	await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('gentilis');
	await ready(page);
	expect((await stl(page)).triangles).not.toEqual(baseline.triangles);
	await page.getByRole('button', { name: 'Add Text Object', exact: true }).click();
	await expect(page.getByTestId('object-row')).toHaveCount(2);
	await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveValue('helvetiker');
	await page.getByRole('textbox', { name: 'Text', exact: true }).fill('XYZ');
	await ready(page);
	await page.getByRole('button', { name: 'Select ABC', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveValue('gentilis');
	await page.getByRole('button', { name: 'Duplicate ABC', exact: true }).click();
	await expect(page.getByTestId('object-row')).toHaveCount(3);
	await expand(page, 'Transform');
	await page.getByRole('combobox', { name: 'Rotation axis', exact: true }).selectOption('x');
	await page.getByRole('spinbutton', { name: 'Rotation angle', exact: true }).fill('45');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Rotation X', exact: true })).toHaveValue('45');
	await page.getByRole('button', { name: 'front', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Position Z', exact: true })).toHaveValue('30');
	await page.getByRole('button', { name: 'top', exact: true }).click();
	for (const mode of ['Inset', 'Flush Inlay', 'Raised']) {
		await page.getByRole('button', { name: mode, exact: true }).click();
		await ready(page);
		expect((await stl(page)).triangles).toBeGreaterThan(100);
	}
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .3MF', exact: true }).click();
	expect((await download).suggestedFilename()).toBe('simple3d-model.3mf');
});

test('flush inlay depth is independent per face and preserved in 3MF', async ({ page }) => {
	async function exportedInlayBounds() {
		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Download .3MF', exact: true }).click();
		const download = await pending;
		const zip = await JSZip.loadAsync(await readFile(await download.path()));
		const xml = await zip.file('3D/3dmodel.model').async('string');
		return page.evaluate((source) => {
			const document = new DOMParser().parseFromString(source, 'application/xml');
			return [...document.querySelectorAll('object')].filter((object) => object.getAttribute('name')?.startsWith('Inlay_')).map((object) => {
				const heights = [...object.querySelectorAll('vertex')].map((vertex) => Number(vertex.getAttribute('z')));
				return [Math.min(...heights), Math.max(...heights)];
			});
		}, xml);
	}
	await page.getByRole('button', { name: 'Flush Inlay', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Inlay Depth', exact: true })).toHaveValue('2');
	await expect(page.getByRole('textbox', { name: 'Extrusion Height', exact: true })).toHaveCount(0);
	await number(page, 'Inlay Depth', 1.25);
	await page.getByRole('button', { name: 'Add Text Object', exact: true }).click();
	await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Bottom');
	await page.getByRole('button', { name: 'bottom', exact: true }).click();
	await number(page, 'Inlay Depth', 3);
	await page.getByRole('button', { name: 'Select ABC', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Inlay Depth', exact: true })).toHaveValue('1.25');
	expect(await exportedInlayBounds()).toEqual([[4.75, 6], [-6, -3]]);
	await number(page, 'Inlay Depth', 0.5);
	expect(await exportedInlayBounds()).toEqual([[5.5, 6], [-6, -3]]);
});

test('transparent base reveals hidden inlays without changing exports', async ({ page }, testInfo) => {
	await page.getByRole('button', { name: 'Flush Inlay', exact: true }).click();
	await page.getByRole('button', { name: 'bottom', exact: true }).click();
	await ready(page);
	const toggle = page.getByRole('button', { name: 'Transparent base preview', exact: true });
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	const original = await stl(page);
	const canvas = page.locator('canvas');
	const countGold = (buffer) => {
		const image = PNG.sync.read(buffer);
		let count = 0;
		for (let offset = 0; offset < image.data.length; offset += 4) {
			const [red, green, blue] = image.data.subarray(offset, offset + 3);
			if (red > 90 && red > green * 1.1 && green > blue * 1.15) count++;
		}
		return count;
	};
	const translucent = await canvas.screenshot({ path: testInfo.outputPath('translucent-base.png') });
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	const opaque = await canvas.screenshot({ path: testInfo.outputPath('opaque-base.png') });
	expect(countGold(translucent)).toBeGreaterThan(countGold(opaque) + 100);
	expect(await stl(page)).toEqual(original);
	await toggle.click();
	await number(page, 'Inlay Depth', 3);
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Fit model (F)', exact: true }).click();
	await expect(toggle).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('translucent-base-mobile.png') });
	for (const mode of ['Raised', 'Inset']) {
		await page.getByRole('button', { name: mode, exact: true }).click();
		await ready(page);
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		const before = await stl(page);
		const transparentPixels = await canvas.screenshot();
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		expect((await canvas.screenshot()).equals(transparentPixels)).toBe(false);
		expect(await stl(page)).toEqual(before);
		await page.getByRole('button', { name: 'Flush Inlay', exact: true }).click();
		await ready(page);
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await toggle.click();
	}
});

test('PNG upload, replacement, hole and threshold controls', async ({ page }) => {
	await page.getByRole('button', { name: 'Delete ABC', exact: true }).click();
	await ready(page);
	const base = await stl(page);
	const image = new PNG({ width: 32, height: 32 });
	for (let vertical = 0; vertical < 32; vertical++) {
		for (let horizontal = 0; horizontal < 32; horizontal++) {
			const offset = (vertical * 32 + horizontal) * 4;
			image.data[offset] = 40; image.data[offset + 1] = 90; image.data[offset + 2] = 200;
			image.data[offset + 3] = horizontal > 3 && horizontal < 28 && vertical > 3 && vertical < 28 && !(horizontal > 12 && horizontal < 19 && vertical > 12 && vertical < 19) ? 255 : 0;
		}
	}
	await page.locator('#mask-file-input').setInputFiles({ name: 'ring.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
	await expect(page.getByRole('img', { name: 'mask', exact: true })).toBeVisible();
	await ready(page);
	expect((await stl(page)).triangles).toBeGreaterThan(base.triangles);
	await number(page, 'Mask Width', 30);
	await page.getByRole('button', { name: 'Inset', exact: true }).click();
	await number(page, 'Inset Depth', 8);
	expect((await stl(page)).size[2]).toBeCloseTo(12, 3);
	await page.getByRole('combobox', { name: 'Mask Channel', exact: true }).selectOption('dark');
	await ready(page);
	image.data.fill(0);
	await page.locator('input[id^="replace-img-"]').setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
	await ready(page);
	await expect.poll(async () => (await stl(page)).triangles).toBe(base.triangles);
});

test('pointer drag, selection and keyboard transform modes', async ({ page }) => {
	const point = await page.evaluate(async () => {
		const rect = document.querySelector('canvas').getBoundingClientRect();
		const radius = Math.hypot(50, 8, 30);
		const aspect = rect.width / rect.height;
		const tangent = Math.tan(25 * Math.PI / 180);
		const distance = radius / Math.sin(Math.atan(tangent * Math.min(1, aspect))) * 1.15;
		const normalize = (vector) => vector.map((value) => value / Math.hypot(...vector));
		const forward = normalize([-140, -110, -160]);
		const right = normalize([160, 0, -140]);
		const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
		const dot = (first, second) => first.reduce((sum, value, index) => sum + value * second[index], 0);
		const delta = [-16, 8, 0];
		const depth = distance + dot(delta, forward);
		return { x: rect.x + (dot(delta, right) / (depth * tangent * aspect) + 1) * rect.width / 2, y: rect.y + (1 - dot(delta, up) / (depth * tangent)) * rect.height / 2 };
	});
	await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
	await expand(page, 'Transform');
	const before = await page.getByRole('textbox', { name: 'Position X', exact: true }).inputValue();
	await page.mouse.move(point.x, point.y); await page.mouse.down();
	await page.mouse.move(point.x + 75, point.y + 20, { steps: 15 }); await page.mouse.up();
	await expect(page.getByRole('textbox', { name: 'Position X', exact: true })).not.toHaveValue(before);
	await ready(page);
	await page.getByRole('button', { name: 'Add Text Object', exact: true }).click();
	await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Second');
	await number(page, 'Position X', 60);
	await number(page, 'Font Size', 8);
	await page.mouse.click(point.x + 75, point.y + 20);
	await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('ABC');
	await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
	await page.mouse.move(point.x + 75, point.y + 20); await page.mouse.down();
	await page.mouse.move(point.x + 85, point.y + 40, { steps: 12 }); await page.mouse.up();
	await ready(page);
	await expect(page.getByRole('textbox', { name: 'Position Y', exact: true })).toHaveValue('6');
	await page.locator('canvas').click({ position: { x: 40, y: 160 } });
	await page.keyboard.press('e');
	await expect(page.getByRole('button', { name: 'Rotate (E)', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('w');
	await expect(page.getByRole('button', { name: 'Move (W)', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

for (const direction of ['+X', '-X', '+Y', '-Y', '+Z', '-Z']) {
	test(`axis view gizmo aligns ${direction} without editing the model`, async ({ page }, testInfo) => {
		if (direction === '-Y') {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.getByRole('button', { name: 'Fit model (F)', exact: true }).click();
		}
		const helper = page.getByRole('group', { name: 'Align view with axis', exact: true });
		const bounds = await helper.boundingBox();
		const normalize = (vector) => vector.map((value) => value / Math.hypot(...vector));
		const forward = normalize([-140, -110, -160]);
		const right = normalize([160, 0, -140]);
		const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
		const axis = { X: 0, Y: 1, Z: 2 }[direction[1]];
		const sign = direction[0] === '+' ? 1 : -1;
		const original = await stl(page);
		await page.mouse.click(bounds.x + 64 + 32 * right[axis] * sign, bounds.y + 64 - 32 * up[axis] * sign);
		await expect(helper).toHaveAttribute('aria-description', `View from ${direction}`);
		await expect(helper).toHaveAttribute('aria-busy', 'false');
		if (direction === '-Y') await tab(page, 'Edit');
		await expand(page, 'Transform');
		await expect(page.getByRole('textbox', { name: 'Position X', exact: true })).toHaveValue('0');
		await expect(page.getByRole('textbox', { name: 'Position Y', exact: true })).toHaveValue('6');
		await expect(page.getByRole('textbox', { name: 'Rotation X', exact: true })).toHaveValue('0');
		expect(await stl(page)).toEqual(original);
		await page.screenshot({ path: testInfo.outputPath(`axis-${direction}.png`) });
		const canvas = await page.locator('canvas').boundingBox();
		await page.mouse.move(canvas.x + 10, canvas.y + 100);
		await page.mouse.down();
		await page.mouse.move(canvas.x + 40, canvas.y + (direction === '+Y' ? 50 : 150), { steps: 12 });
		await page.mouse.up();
		await expect(helper).toHaveAttribute('aria-description', 'Orbit view');
	});
}

test('rotation gizmo commits a quaternion and custom axes are editable', async ({ page }) => {
	await expand(page, 'Transform');
	await page.getByRole('button', { name: 'Rotate (E)', exact: true }).click();
	const canvas = page.locator('canvas');
	const image = PNG.sync.read(await canvas.screenshot());
	const red = [];
	for (let vertical = 80; vertical < image.height; vertical++) {
		for (let horizontal = 0; horizontal < image.width; horizontal++) {
			const offset = (vertical * image.width + horizontal) * 4;
			if (image.data[offset] > 180 && image.data[offset + 1] < 85 && image.data[offset + 2] < 85) red.push({ x: horizontal, y: vertical });
		}
	}
	expect(red.length).toBeGreaterThan(20);
	const bounds = await canvas.boundingBox();
	const point = red[Math.floor(red.length / 2)];
	await page.mouse.move(bounds.x + point.x, bounds.y + point.y); await page.mouse.down();
	await page.mouse.move(bounds.x + point.x + 45, bounds.y + point.y - 30, { steps: 15 }); await page.mouse.up();
	await expect(page.getByRole('textbox', { name: 'Rotation X', exact: true })).not.toHaveValue('0');
	await ready(page);
	await page.getByRole('combobox', { name: 'Rotation axis', exact: true }).selectOption('custom');
	await page.getByRole('spinbutton', { name: 'Axis X', exact: true }).fill('1');
	await page.getByRole('spinbutton', { name: 'Axis Y', exact: true }).fill('2');
	await page.getByRole('spinbutton', { name: 'Axis Z', exact: true }).fill('3');
	await page.getByRole('spinbutton', { name: 'Rotation angle', exact: true }).fill('30');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await ready(page);
	await expect(page.getByRole('textbox', { name: 'Rotation Z', exact: true })).not.toHaveValue('0');
});

test('invalid image reports an error and a valid replacement recovers', async ({ page }) => {
	await page.locator('#mask-file-input').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
	await expect(page.getByRole('alert')).toContainText('Unable to decode');
	const image = new PNG({ width: 4, height: 4 });
	image.data.fill(255);
	await page.locator('#mask-file-input').setInputFiles({ name: 'valid.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
	await expect(page.getByTestId('object-row')).toHaveCount(2);
	await ready(page);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
	test(`nonblank interactive canvas and layout ${viewport.width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize(viewport);
		await page.getByRole('button', { name: 'Fit model (F)', exact: true }).click();
		const canvas = page.locator('canvas');
		const first = await canvas.screenshot();
		const image = PNG.sync.read(first);
		let bright = 0;
		for (let offset = 0; offset < image.data.length; offset += 4) {
			if (image.data[offset] > 65 && image.data[offset + 1] > 65 && image.data[offset + 2] > 65) bright++;
		}
		expect(bright).toBeGreaterThan(image.width * image.height * 0.03);
		const bounds = await canvas.boundingBox();
		await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.2);
		await page.mouse.down();
		await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.3, { steps: 15 });
		await page.mouse.up();
		expect((await canvas.screenshot()).equals(first)).toBe(false);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`editor-${viewport.width}.png`) });
	});
}

test('shapes, holes, SVG outlines, per-object modes and mirroring', async ({ page }) => {
	await page.getByRole('button', { name: 'Delete ABC', exact: true }).click();
	await ready(page);
	const base = await stl(page);
	await page.getByRole('button', { name: 'Add Shape', exact: true }).click();
	await ready(page);
	await page.getByRole('button', { name: 'Heart', exact: true }).click();
	await ready(page);
	const heart = await stl(page);
	expect(heart.triangles).toBeGreaterThan(base.triangles);
	expect(heart.size[2]).toBeCloseTo(16, 3);
	await page.getByRole('combobox', { name: 'Object Mode', exact: true }).selectOption('inset');
	await expect(page.getByRole('textbox', { name: 'Extrusion Height', exact: true })).toHaveCount(0);
	await number(page, 'Object Inset Depth', 3);
	expect((await stl(page)).size[2]).toBeCloseTo(12, 3);
	await page.getByRole('checkbox', { name: 'Mirror (for stamps)', exact: true }).check();
	await ready(page);

	await page.getByRole('button', { name: 'Add Hole', exact: true }).click();
	await number(page, 'Hole Diameter', 8);
	await expand(page, 'Transform');
	await number(page, 'Position X', 35);
	const plain = await stl(page);
	await page.getByRole('combobox', { name: 'Hole Head', exact: true }).selectOption('countersink');
	await number(page, 'Head Diameter', 14);
	expect((await stl(page)).triangles).not.toEqual(plain.triangles);
	await expect(page.getByTestId('object-row')).toHaveCount(2);

	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect x="0" y="0" width="12" height="10"/><rect x="8" y="2" width="12" height="6"/><script>window.pwned = true</script></svg>';
	await page.locator('#svg-file-input').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
	await expect(page.getByRole('img', { name: 'svg outline', exact: true })).toBeVisible();
	await ready(page);
	await number(page, 'SVG Width', 20);
	await number(page, 'Position X', -30);
	expect(await page.evaluate(() => window.pwned)).toBeUndefined();
	await page.locator('#svg-file-input').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') });
	await expect(page.getByRole('alert')).toContainText('no filled shapes');
	await expect(page.getByTestId('object-row')).toHaveCount(3);
});

test('hollow shell with lid exports a separate lid laid out for printing', async ({ page }) => {
	await tab(page, 'Base');
	await number(page, 'Height', 30);
	await page.getByRole('checkbox', { name: 'Hollow shell', exact: true }).check();
	await ready(page);
	await page.getByRole('checkbox', { name: 'Add lid', exact: true }).check();
	await ready(page);
	const toggle = page.getByRole('button', { name: 'Lay out for print', exact: true });
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	const exported = await stl(page);
	expect(exported.size[0]).toBeCloseTo(210, 2);
	expect(exported.size[2]).toBeCloseTo(30, 2);
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	expect(await stl(page)).toEqual(exported);
	await toggle.click();

	await page.getByRole('combobox', { name: 'Body', exact: true }).selectOption('lid');
	await ready(page);
	const xml = await modelXml(page);
	expect(xml.match(/<item /g)).toHaveLength(2);
	expect(xml).toContain('name="Lid_Mesh"');
	expect(xml).toContain('name="Simple3D_Lid"');

	await page.getByRole('combobox', { name: 'Body', exact: true }).selectOption('base');
	await page.getByRole('combobox', { name: 'Object Mode', exact: true }).selectOption('inset');
	await number(page, 'Object Inset Depth', 2);
	await expect(page.getByRole('status')).toContainText('break through');
	await number(page, 'Object Inset Depth', 1);
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('presets and project save/load round-trip', async ({ page }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await fileMenu(page, 'Box with lid');
	await ready(page);
	await expect(page.getByTestId('object-row')).toHaveCount(2);
	await tab(page, 'Base');
	await expect(page.getByRole('textbox', { name: 'Lid Thickness', exact: true })).toHaveValue('2.4');
	await number(page, 'Width', 90);
	const pending = page.waitForEvent('download');
	await fileMenu(page, 'Save project');
	const saved = await readFile(await (await pending).path());
	expect(JSON.parse(saved.toString()).app).toBe('simple3d');

	await fileMenu(page, 'Dice');
	await ready(page);
	await tab(page, 'Objects');
	await expect(page.getByTestId('object-row')).toHaveCount(6);
	expect((await modelXml(page)).match(/name="Inlay_/g)).toHaveLength(6);

	await page.locator('#project-file-input').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: saved });
	await ready(page);
	await expect(page.getByTestId('object-row')).toHaveCount(2);
	await tab(page, 'Base');
	await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('90');
	await expect(page.getByRole('checkbox', { name: 'Add lid', exact: true })).toBeChecked();
	await page.locator('#project-file-input').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
	await expect(page.getByRole('alert')).toContainText('not valid JSON');
	await tab(page, 'Objects');
	await expect(page.getByTestId('object-row')).toHaveCount(2);
	await fileMenu(page, 'New project');
	await expect(page.getByTestId('object-row')).toHaveCount(1);
});

test('multi-line text, alignment, spacing and uploaded fonts', async ({ page }) => {
	// A 1 mm base makes the exported bounds measure the raised text itself.
	await tab(page, 'Base');
	await number(page, 'Width', 1);
	await number(page, 'Depth', 1);
	const text = page.getByRole('textbox', { name: 'Text', exact: true });
	await text.fill('ABC');
	await ready(page);
	const single = await stl(page);
	await expect(page.getByRole('textbox', { name: 'Line Spacing', exact: true })).toHaveCount(0);
	await text.fill('ABC\nAB');
	await ready(page);
	const twoLines = await stl(page);
	expect(twoLines.size[1]).toBeGreaterThan(single.size[1] + 10);
	expect(twoLines.size[0]).toBeCloseTo(single.size[0], 3);
	await number(page, 'Line Spacing', 2);
	expect((await stl(page)).size[1]).toBeGreaterThan(twoLines.size[1] + 10);
	await number(page, 'Letter Spacing', 2);
	expect((await stl(page)).size[0]).toBeCloseTo(single.size[0] + 4, 2);
	const left = page.getByRole('button', { name: 'Align left', exact: true });
	await left.click();
	await expect(left).toHaveAttribute('aria-pressed', 'true');
	await ready(page);
	const helvetiker = await stl(page);

	const font = page.getByRole('combobox', { name: 'Font', exact: true });
	await page.locator('#font-file-input').setInputFiles({ name: 'Blocks.otf', mimeType: 'font/otf', buffer: Buffer.from(makeTestFont()) });
	await expect(font).toHaveValue('custom-1');
	await expect(font.locator('option:checked')).toHaveText('Blocks');
	await ready(page);
	expect((await stl(page)).triangles).toBeLessThan(helvetiker.triangles / 2);
	await page.locator('#font-file-input').setInputFiles({ name: 'broken.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') });
	await expect(page.getByRole('alert')).toContainText('Unable to read font');
	await expect(font).toHaveValue('custom-1');

	const pending = page.waitForEvent('download');
	await fileMenu(page, 'Save project');
	const project = JSON.parse((await readFile(await (await pending).path())).toString());
	expect(project.settings.customFonts.map((entry) => entry.label)).toEqual(['Blocks']);
	expect(project.settings.objects[0]).toMatchObject({ font: 'custom-1', align: 'left', letterSpacing: 2, lineHeight: 2, text: 'ABC\nAB' });
});

test('multi-select alignment, distribution, nudging and shortcuts', async ({ page }) => {
	await expand(page, 'Transform');
	const text = page.getByRole('textbox', { name: 'Text', exact: true });
	for (const [label, x, z] of [['Second', 30, 12], ['Third', -30, -8]]) {
		await page.getByRole('button', { name: 'Add Text Object', exact: true }).click();
		await text.fill(label);
		await number(page, 'Position X', x);
		await number(page, 'Position Z', z);
	}
	const selectAll = async () => {
		await page.getByRole('button', { name: 'Select ABC', exact: true }).click();
		await page.getByRole('button', { name: 'Select Second', exact: true }).click({ modifiers: ['Shift'] });
		await page.getByRole('button', { name: 'Select Third', exact: true }).click({ modifiers: ['Shift'] });
		await expect(page.getByText('3 objects selected', { exact: true })).toBeVisible();
	};
	const positionOf = async (label, axis) => {
		await page.getByRole('button', { name: `Select ${label}`, exact: true }).click();
		return page.getByRole('textbox', { name: `Position ${axis}`, exact: true }).inputValue();
	};

	await selectAll();
	const axes = page.getByRole('group', { name: 'Align axis', exact: true });
	await axes.getByRole('button', { name: 'Z', exact: true }).click();
	await page.getByRole('button', { name: 'Align Z center', exact: true }).click();
	await ready(page);
	const aligned = await positionOf('Third', 'Z');
	expect(await positionOf('Second', 'Z')).toBe(aligned);
	expect(await positionOf('ABC', 'Z')).toBe(aligned);
	expect(await positionOf('Second', 'X')).toBe('30');

	await selectAll();
	await axes.getByRole('button', { name: 'X', exact: true }).click();
	await page.getByRole('button', { name: 'Distribute along X', exact: true }).click();
	await ready(page);
	expect(await positionOf('Second', 'X')).toBe('30');
	expect(await positionOf('Third', 'X')).toBe('-30');
	expect(await positionOf('ABC', 'X')).not.toBe('0');

	const x = page.getByRole('textbox', { name: 'Position X', exact: true });
	await page.getByRole('button', { name: 'Select Second', exact: true }).click();
	await page.keyboard.press('ArrowRight');
	await expect(x).toHaveValue('31');
	await page.keyboard.press('Shift+ArrowLeft');
	await expect(x).toHaveValue('21');
	await page.getByRole('button', { name: 'Center on face', exact: true }).click();
	await expect(x).toHaveValue('0');
	await expect(page.getByRole('textbox', { name: 'Position Z', exact: true })).toHaveValue('0');
	await ready(page);

	await page.getByRole('button', { name: 'Select Second', exact: true }).focus();
	await page.keyboard.press('Control+d');
	await expect(page.getByTestId('object-row')).toHaveCount(4);
	await page.keyboard.press('Delete');
	await expect(page.getByTestId('object-row')).toHaveCount(3);
	await page.keyboard.press('Escape');
	await expect(page.getByText('Select an object to edit it.', { exact: true })).toBeVisible();

	const grid = page.getByRole('button', { name: 'Grid snap', exact: true });
	await grid.click();
	await expect(grid).toHaveAttribute('aria-pressed', 'true');
	await ready(page);
});