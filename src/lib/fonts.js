import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';

export const FONTS = [
	{ id: 'helvetiker', label: 'Helvetiker', file: 'helvetiker.typeface.json' },
	{ id: 'helvetiker_bold', label: 'Helvetiker Bold', file: 'helvetiker_bold.typeface.json' },
	{ id: 'optimer', label: 'Optimer', file: 'optimer_regular.typeface.json' },
	{ id: 'gentilis', label: 'Gentilis', file: 'gentilis_regular.typeface.json' },
];

export const MAX_FONT_BYTES = 10 * 1024 * 1024;
export const CUSTOM_FONT_ID = /^custom-\d+$/;
const parsed = new Map();

export function bufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return btoa(binary);
}

/** Parses base64 TTF/OTF data into a THREE Font (cached). Throws a user-facing error. */
export function parseFontData(base64) {
	if (parsed.has(base64)) return parsed.get(base64);
	let font;
	try {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		font = new FontLoader().parse(new TTFLoader().parse(bytes.buffer));
	} catch {
		throw new Error('Unable to read font. Choose a valid TTF or OTF file.');
	}
	if (!font.data?.glyphs || !Object.keys(font.data.glyphs).length) throw new Error('Font contains no glyphs.');
	parsed.set(base64, font);
	return font;
}

/** Bundled fonts followed by the project's uploaded fonts. */
export function fontOptions(settings) {
	return [...FONTS, ...(settings.customFonts || []).map(({ id, label }) => ({ id, label }))];
}

export function objectFont(fonts, object, settings) {
	if (fonts?.isFont) return fonts;
	const id = object.font || settings.font || 'helvetiker';
	if (fonts?.[id]) return fonts[id];
	const custom = settings.customFonts?.find((entry) => entry.id === id);
	return custom ? parseFontData(custom.data) : fonts?.helvetiker;
}