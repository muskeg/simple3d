import { useEffect, useRef, useState } from 'react';

const formatValue = (v) => String(Number(v.toFixed(3)));

/**
 * Compact typeable number field. Typed values commit on Enter/blur (clamped,
 * NaN reverts; Escape cancels). Drag the label horizontally to scrub the
 * value (Shift x10, Alt x0.1); ArrowUp/ArrowDown in the input step it.
 * `stacked` puts the label above the input for multi-column grids.
 */
export default function NumberField({ label, value, min, max, step = 0.5, suffix = '', onChange, hardMax, ariaLabel, stacked = false }) {
	const [text, setText] = useState(String(value));
	const [focused, setFocused] = useState(false);
	// Set on Escape so the subsequent blur() doesn't re-commit the typed text.
	const skipCommitRef = useRef(false);
	const scrubRef = useRef(null);
	const lower = min < 0 ? -1000000 : min;
	const upper = hardMax ?? Math.max(max ?? 1000000, 1000000);

	useEffect(() => {
		if (!focused) setText(formatValue(value));
	}, [value, focused]);

	const clamp = (v) => Number(Math.min(upper, Math.max(lower, v)).toFixed(3));

	function commit(raw) {
		const v = raw.trim() === '' ? NaN : Number(raw);
		if (!Number.isFinite(v)) {
			setText(formatValue(value));
			return;
		}
		const next = clamp(v);
		setText(formatValue(next));
		if (next !== value) onChange(next);
	}

	const factor = (event) => (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);

	const scrubHandlers = {
		onPointerDown: (event) => {
			if (event.button !== 0) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			scrubRef.current = { x: event.clientX, value };
		},
		onPointerMove: (event) => {
			const scrub = scrubRef.current;
			if (!scrub) return;
			const next = clamp(scrub.value + Math.round((event.clientX - scrub.x) / 3) * step * factor(event));
			if (next !== value) onChange(next);
		},
		onPointerUp: (event) => {
			scrubRef.current = null;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		},
	};
	scrubHandlers.onPointerCancel = scrubHandlers.onPointerUp;

	return (
		<div className={stacked ? 'min-w-0' : 'flex items-center justify-between gap-2'}>
			<span
				{...scrubHandlers}
				title="Drag to adjust"
				className={`cursor-ew-resize touch-none select-none truncate text-xs text-neutral-400 hover:text-neutral-200 ${stacked ? 'mb-0.5 block text-[10px] uppercase tracking-wide' : ''}`}
			>
				{label}
			</span>
			<input
				type="text"
				inputMode="decimal"
				aria-label={ariaLabel || label}
				className={`rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-right text-xs tabular-nums text-neutral-100 outline-none focus:border-indigo-500 ${stacked ? 'w-full' : 'w-20'}`}
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
					if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
						e.preventDefault();
						const next = clamp((Number(text) || value) + (e.key === 'ArrowUp' ? 1 : -1) * step * factor(e));
						setText(formatValue(next));
						if (next !== value) onChange(next);
					}
				}}
			/>
			{suffix && <span className="sr-only">{suffix}</span>}
		</div>
	);
}

/** Three stacked NumberFields for an {x, y, z} value; aria labels are "<ariaPrefix> X" etc. */
export function VectorField({ label, ariaPrefix, value, onChange, step = 0.5, min = -1000, max = 1000 }) {
	return (
		<div>
			<p className="mb-1 text-[11px] text-neutral-500">{label}</p>
			<div className="grid grid-cols-3 gap-1.5">
				{['x', 'y', 'z'].map((axis) => (
					<NumberField key={axis} stacked label={axis.toUpperCase()} ariaLabel={`${ariaPrefix} ${axis.toUpperCase()}`} value={value[axis]} min={min} max={max} step={step} onChange={(v) => onChange(axis, v)} />
				))}
			</div>
		</div>
	);
}
