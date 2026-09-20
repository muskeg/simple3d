export const FONTS = [
	{ id: 'helvetiker', label: 'Helvetiker', file: 'helvetiker.typeface.json' },
	{ id: 'helvetiker_bold', label: 'Helvetiker Bold', file: 'helvetiker_bold.typeface.json' },
	{ id: 'optimer', label: 'Optimer', file: 'optimer_regular.typeface.json' },
	{ id: 'gentilis', label: 'Gentilis', file: 'gentilis_regular.typeface.json' },
];

export function objectFont(fonts, object, settings) {
	return fonts?.isFont ? fonts : fonts?.[object.font || settings.font || 'helvetiker'];
}