import { useEffect, useRef, useState } from 'react';

/**
 * Slider + typeable number input. Slider changes commit immediately;
 * typed values commit on Enter/blur (clamped to min/max, NaN reverts).
 * Shows the exact current value when not being edited.
 */
export default function NumberField({ label, value, min, max, step = 0.5, suffix = '', onChange, hardMax, ariaLabel }) {
	const [text, setText] = useState(String(value));
	const [focused, setFocused] = useState(false);
	// Set on Escape so the subsequent blur() doesn't re-commit the typed text.
	const skipCommitRef = useRef(false);

	useEffect(() => {
		if (!focused) setText(formatValue(value));
	}, [value, focused]);

	function commit(raw) {
		let v = raw.trim() === '' ? NaN : Number(raw);
		if (!Number.isFinite(v)) {
			setText(formatValue(value));
			return;
		}
		v = Math.min(hardMax ?? 1000000, Math.max(min < 0 ? -1000000 : min, v));
		v = Number(v.toFixed(3));
		setText(formatValue(v));
		if (v !== value) onChange(v);
	}

	function formatValue(v) {
		return String(Number(v.toFixed(3)));
	}

	return (
		<div>
			<div className="mb-1 flex items-center justify-between gap-2 text-xs text-neutral-300">
				<span className="truncate">{label}</span>
				<input
					type="text"
					inputMode="decimal"
					aria-label={ariaLabel || label}
					className="w-20 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-right text-xs tabular-nums text-neutral-100 outline-none focus:border-indigo-500"
					value={focused ? text : formatValue(value)}
					onFocus={(e) => {
						setFocused(true);
						setText(formatValue(value));
						e.target.select();
					}}
					onChange={(e) => setText(e.target.value)}
					onBlur={(e) => {
						setFocused(false);
						if (skipCommitRef.current) {
							skipCommitRef.current = false;
							return;
						}
						commit(e.target.value);
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') e.currentTarget.blur();
						if (e.key === 'Escape') {
							skipCommitRef.current = true;
							setText(formatValue(value));
							e.currentTarget.blur();
						}
					}}
				/>
			</div>
			<input
				type="range"
				aria-label={`${ariaLabel || label} slider`}
				min={min}
				max={max}
				step="any"
				value={Math.min(max, Math.max(min, value))}
				onChange={(e) => onChange(Number(Math.max(min, Math.min(max, Math.round(Number(e.target.value) / step) * step)).toFixed(3)))}
				className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-700"
			/>
			{suffix && <div className="sr-only">{suffix}</div>}
		</div>
	);
}
