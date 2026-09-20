import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

async function ready(page) {
	await expect(page.getByRole('button', { name: 'Download .STL', exact: true })).toBeEnabled();
	await expect(page.getByRole('alert')).toHaveCount(0);
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

test.beforeEach(async ({ page }) => {
	page.on('pageerror', (error) => { throw error; });
	await page.goto('./');
	await ready(page);
});

test('numeric edits, cancellation, exact exported dimensions and empty base', async ({ page }) => {
	await page.getByRole('button', { name: 'Delete ABC', exact: true }).click();
	await ready(page);
	await expect(page.getByTestId('object-row')).toHaveCount(0);
	await number(page, 'Width', 1200.125);
	await number(page, 'Height', 18.25);
	const field = page.getByRole('textbox', { name: 'Width', exact: true });
	await field.fill('900'); await field.press('Escape');
	await expect(field).toHaveValue('1200.125');
	await field.fill('12oops'); await field.press('Enter');
	await expect(field).toHaveValue('1200.125');
	await field.fill('Infinity'); await field.press('Enter');
	await expect(field).toHaveValue('1200.125');
	for (const shape of ['Box', 'Cylinder', 'Sphere', 'Cone', 'Pyramid']) {
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

test('rotation gizmo commits a quaternion and custom axes are editable', async ({ page }) => {
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