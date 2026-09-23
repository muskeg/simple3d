/** Twelve outward-wound triangles of an axis-aligned box from `min` to `max`. */
export function boxTriangles(min, max) {
	const corner = (i, j, k) => [i ? max[0] : min[0], j ? max[1] : min[1], k ? max[2] : min[2]];
	const quads = [
		[[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
		[[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
		[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
		[[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
		[[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
		[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
	].map((quad) => quad.map((index) => corner(...index)));
	return quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
}

export const inverted = (triangles) => triangles.map(([a, b, c]) => [a, c, b]);

export function binarySTL(triangles) {
	const buffer = new ArrayBuffer(84 + triangles.length * 50);
	const view = new DataView(buffer);
	view.setUint32(80, triangles.length, true);
	triangles.forEach((triangle, index) => {
		triangle.forEach((vertex, corner) => vertex.forEach((value, axis) => view.setFloat32(84 + index * 50 + 12 + corner * 12 + axis * 4, value, true)));
	});
	return buffer;
}

export function asciiSTL(triangles) {
	const facets = triangles.map((triangle) => `facet normal 0 0 0\nouter loop\n${triangle.map((vertex) => `vertex ${vertex.join(' ')}`).join('\n')}\nendloop\nendfacet`);
	return new TextEncoder().encode(`solid test\n${facets.join('\n')}\nendsolid test\n`).buffer;
}

export function objFile(triangles) {
	const lines = triangles.flatMap((triangle) => triangle.map((vertex) => `v ${vertex.join(' ')}`));
	for (let index = 0; index < triangles.length; index++) lines.push(`f ${index * 3 + 1} ${index * 3 + 2} ${index * 3 + 3}`);
	return new TextEncoder().encode(lines.join('\n')).buffer;
}
