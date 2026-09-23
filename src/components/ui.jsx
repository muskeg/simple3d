import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export function usePersistentState(key, initial) {
	const [value, setValue] = useState(() => {
		try {
			const stored = localStorage.getItem(key);
			return stored === null ? initial : JSON.parse(stored);
		} catch { return initial; }
	});
	useEffect(() => {
		try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
	}, [key, value]);
	return [value, setValue];
}

export function useMediaQuery(query) {
	const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, [query]);
	return matches;
}

/** Collapsible panel section; open state is remembered per `id`. */
export function Section({ id, title, children, hint, defaultOpen = true, actions }) {
	const [open, setOpen] = usePersistentState(`simple3d.ui.${id}`, defaultOpen);
	return (
		<section className="border-b border-white/5 px-3 py-2.5">
			<div className="flex items-center gap-1">
				<button onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-1 items-center gap-1 py-0.5 text-left">
					<ChevronRight size={12} className={`text-indigo-300/70 transition-transform ${open ? 'rotate-90' : ''}`} />
					<h2 className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300/80">{title}</h2>
				</button>
				{actions}
			</div>
			{open && (
				<div className="mt-2.5 space-y-2.5">
					{hint && <p className="text-[11px] leading-relaxed text-neutral-500">{hint}</p>}
					{children}
				</div>
			)}
		</section>
	);
}

/** Nested collapsible group (Advanced, Transform); closed by default. */
export function Group({ id, title, children, defaultOpen = false }) {
	const [open, setOpen] = usePersistentState(`simple3d.ui.${id}`, defaultOpen);
	return (
		<div className="rounded-md border border-white/5 bg-neutral-950/30">
			<button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[11px] font-medium text-neutral-400 hover:text-neutral-200">
				<ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
				{title}
			</button>
			{open && <div className="space-y-2.5 px-2 pb-2">{children}</div>}
		</div>
	);
}

export function Checkbox({ label, checked, onChange }) {
	return (
		<label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
			<input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 accent-indigo-500" />
			{label}
		</label>
	);
}

export function Select({ label, value, onChange, options, hideLabel }) {
	return (
		<label className={`text-xs text-neutral-300 ${hideLabel ? 'block' : 'flex items-center justify-between gap-2'}`}>
			{!hideLabel && <span className="shrink-0">{label}</span>}
			<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs">
				{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
			</select>
		</label>
	);
}

const toggleClass = (active) => (active
	? 'border-indigo-500 bg-indigo-500/15 text-indigo-100'
	: 'border-neutral-700/70 bg-neutral-800/40 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100');

/** Row of mutually exclusive buttons; options may carry an Icon (shown with a tooltip). */
export function Segmented({ label, value, options, onChange, iconOnly = false, columns }) {
	return (
		<div role="group" aria-label={label} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns || options.length}, minmax(0, 1fr))` }}>
			{options.map(({ id, label: optionLabel, Icon, disabled }) => (
				<button
					key={id}
					onClick={() => onChange(id)}
					disabled={disabled}
					aria-label={optionLabel}
					aria-pressed={value === id}
					title={optionLabel}
					className={`flex items-center justify-center gap-1 rounded-md border px-1 py-1 text-[11px] transition disabled:opacity-40 ${iconOnly || !Icon ? '' : 'flex-col'} ${toggleClass(value === id)}`}
				>
					{Icon && <Icon size={14} />}
					{(!iconOnly || !Icon) && <span className="leading-tight">{optionLabel}</span>}
				</button>
			))}
		</div>
	);
}

export function IconButton({ label, Icon, onClick, disabled, active, className = '' }) {
	return (
		<button onClick={onClick} disabled={disabled} aria-label={label} title={label} className={`grid h-7 min-w-7 place-items-center rounded-md border px-1 transition disabled:opacity-40 ${toggleClass(active)} ${className}`}>
			<Icon size={14} />
		</button>
	);
}

/** Dropdown menu. Items render only while open; outside clicks and Escape close it. */
export function Menu({ label, trigger, children, align = 'left', buttonClassName = '' }) {
	const [open, setOpen] = useState(false);
	const ref = useRef(null);
	useEffect(() => {
		if (!open) return undefined;
		const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
		const key = (event) => { if (event.key === 'Escape') setOpen(false); };
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', key);
		return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
	}, [open]);
	return (
		<div ref={ref} className="relative">
			<button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} className={buttonClassName}>{trigger}</button>
			{open && (
				<div role="menu" className={`absolute z-30 mt-1 min-w-48 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`} onClick={() => setOpen(false)}>
					{children}
				</div>
			)}
		</div>
	);
}

export function MenuItem({ children, onClick, Icon, disabled }) {
	return (
		<button role="menuitem" onClick={onClick} disabled={disabled} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40">
			{Icon && <Icon size={13} className="text-neutral-400" />}
			{children}
		</button>
	);
}

export function MenuLabel({ children }) {
	return <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{children}</div>;
}
