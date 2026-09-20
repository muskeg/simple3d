import * as THREE from 'three';
import { contours } from 'd3-contour';

/**
 * PNG mask pipeline.
 *
 * Alpha or luminance is thresholded and traced with d3-contour. Polygon
 * rings preserve holes and disconnected islands. The full image width,
 * including transparent margins, is the object's fontSize in millimeters.
 *
 * The result is authored as a UNIT PRISM, the same convention as text:
 * flat side on local XZ, extrusion toward +Y, centered on the origin,
 * height exactly 1. Image +X -> local +X, image top -> local -Z (so the
 * image reads upright on the top face).
 *
 * Cached geometry is borrowed; callers clone it before mutation/disposal.
 */
const cache = new Map();
const MAX_CACHE = 24;
const imageCache = new Map(); // dataURL -> HTMLImageElement

/** Decodes a dataURL into an HTMLImageElement (cached). */
export async function preloadMaskImage(dataURL) {
	if (imageCache.has(dataURL)) return imageCache.get(dataURL);
	const image = new Image();
	image.src = dataURL;
	try {
		await image.decode();
	} catch {
		throw new Error('Unable to decode image. Choose a valid PNG, JPEG, WebP or GIF.');
	}
	imageCache.set(dataURL, image);
	return image;
}

/** Synchronous lookup of a decoded image element. */
export function getMaskImage(dataURL) {
	return imageCache.get(dataURL) || null;
}

/** Returns a (possibly cached) unit-prism geometry for an image object, or null if fully transparent. */
export function getMaskGeometry(obj) {
	const key = `${obj.image ?? ''}|${obj.fontSize ?? 40}|${obj.threshold ?? 128}|${obj.maskResolution ?? 256}|${obj.maskChannel ?? 'alpha'}`;
	let entry = cache.get(key);
	if (!entry) {
		const image = getMaskImage(obj.image);
		if (!image) return null;
		entry = { geom: image ? buildMaskGeometry(image, obj) : null };
		cache.set(key, entry);
		if (cache.size > MAX_CACHE) {
			const oldestKey = cache.keys().next().value;
			const oldest = cache.get(oldestKey);
			cache.delete(oldestKey);
			oldest?.geom?.dispose?.();
		}
	}
	return entry.geom;
}

/** Drops cached mask geometries and decoded images. */
export function clearMaskCache() {
	for (const e of cache.values()) e.geom?.dispose?.();
	cache.clear();
	imageCache.clear();
}

function buildMaskGeometry(image, obj) {
	const maxDim = Math.max(32, Math.min(1024, Math.round(obj.maskResolution ?? 256)));
	const iw = image.naturalWidth || image.width || 0;
	const ih = image.naturalHeight || image.height || 0;
	if (iw < 1 || ih < 1) return null;

	const scale = Math.min(1, maxDim / Math.max(iw, ih));
	const w = Math.max(1, Math.round(iw * scale));
	const h = Math.max(1, Math.round(ih * scale));

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.clearRect(0, 0, w, h);
	ctx.drawImage(image, 0, 0, w, h);
	const data = ctx.getImageData(0, 0, w, h).data;
	return maskGeometryFromPixels(data, w, h, obj);
}

export function maskGeometryFromPixels(pixels, width, height, object) {
	const threshold = Math.max(1, Math.min(255, object.threshold ?? 128));
	const values = new Uint8Array(width * height);
	for (let index = 0; index < values.length; index++) {
		const offset = index * 4;
		const alpha = pixels[offset + 3];
		const luminance = 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
		const channel = object.maskChannel || 'alpha';
		const value = channel === 'dark' ? (255 - luminance) * alpha / 255 : channel === 'light' ? luminance * alpha / 255 : alpha;
		values[index] = value >= threshold ? 1 : 0;
	}
	const polygons = contours().size([width, height]).smooth(false).thresholds([0.5])(values)[0].coordinates;
	if (!polygons.length) return null;
	const scale = Math.max(0.1, object.fontSize ?? 40) / width;
	const shapes = polygons.map((rings) => {
		const paths = rings.map((ring) => ring.map(([horizontal, vertical]) => new THREE.Vector2((horizontal - width / 2) * scale, (height / 2 - vertical) * scale)));
		const shape = new THREE.Shape(paths[0]);
		shape.holes = paths.slice(1).map((points) => new THREE.Path(points));
		return shape;
	});
	const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
	geometry.rotateX(-Math.PI / 2);
	geometry.translate(0, -0.5, 0);
	geometry.computeVertexNormals();
	return geometry;
}
