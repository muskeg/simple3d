import opentype from 'three/examples/jsm/libs/opentype.module.js';

/** Minimal OTF: "A" is a 500x700 box, "B" the same box with a square hole, plus a space. */
export function makeTestFont() {
	const box = (path, x0, y0, x1, y1, clockwise = false) => {
		const points = clockwise ? [[x0, y0], [x0, y1], [x1, y1], [x1, y0]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
		path.moveTo(...points[0]);
		for (const point of points.slice(1)) path.lineTo(...point);
		path.close();
		return path;
	};
	const a = box(new opentype.Path(), 50, 0, 550, 700);
	const b = box(box(new opentype.Path(), 50, 0, 550, 700), 200, 200, 400, 500, true);
	const glyphs = [
		new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 600, path: new opentype.Path() }),
		new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 300, path: new opentype.Path() }),
		new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path: a }),
		new opentype.Glyph({ name: 'B', unicode: 66, advanceWidth: 600, path: b }),
	];
	return new opentype.Font({ familyName: 'Test Blocks', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs }).toArrayBuffer();
}
