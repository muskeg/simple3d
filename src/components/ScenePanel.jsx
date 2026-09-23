import { useEffect, useRef, useState } from 'react';
import NumberField from './NumberField.jsx';
import { Section, Group, Checkbox, Segmented, IconButton, Menu, MenuItem, MenuLabel } from './ui.jsx';
import { BASE_SHAPES, SHELL_SHAPES } from '../lib/baseShapes.js';
import { MAX_SVG_BYTES } from '../lib/svg.js';
import { objectLabel } from '../lib/objects.js';
import { lidEnabled, shellEnabled } from '../lib/bodies.js';
import { PRESETS } from '../lib/presets.js';
import { Copy, Trash2, Image, Type, Download, Shapes, CircleDot, FileCode, Save, FolderOpen, ChevronDown, FilePlus, Box, Cylinder, Circle, Cone, Pyramid, Hexagon, Disc, Donut, Menu as MenuIcon, Sparkles, Undo2, Redo2, X } from 'lucide-react';

export const MODES = [
	{ id: 'raised', label: 'Raised' },
	{ id: 'inset', label: 'Inset' },
	{ id: 'flush_inlay', label: 'Flush Inlay' },
];

const SHAPE_ICONS = { box: Box, cylinder: Cylinder, sphere: Circle, cone: Cone, pyramid: Pyramid, ngon: Hexagon, tube: Disc, torus: Donut };

const ADD_BUTTONS = [
	{ type: 'text', label: 'Text', aria: 'Add Text Object', Icon: Type },
	{ type: 'image', label: 'Image', aria: 'Add Image Mask', Icon: Image },
	{ type: 'svg', label: 'SVG', aria: 'Add SVG', Icon: FileCode },
	{ type: 'shape', label: 'Shape', aria: 'Add Shape', Icon: Shapes },
	{ type: 'hole', label: 'Hole', aria: 'Add Hole', Icon: CircleDot },
];

export const TYPE_ICONS = { text: Type, image: Image, svg: FileCode, shape: Shapes, hole: CircleDot };

function readFileAsDataURL(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/** Validates and reads an image upload as a data URL. */
export async function readImageFile(file) {
	if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
	if (file.size > 20 * 1024 * 1024) throw new Error('Image exceeds the 20 MB limit.');
	return readFileAsDataURL(file);
}

/** Validates and reads an SVG upload as text. */
export async function readSvgFile(file) {
	if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') throw new Error('Choose an SVG file.');
	if (file.size > MAX_SVG_BYTES) throw new Error('SVG exceeds the 2 MB limit.');
	return file.text();
}

function BaseTab({ settings: s, setNumber }) {
	const isFilleted = s.chamfer > 0 && s.chamferSegments > 1;
	const hasLid = lidEnabled(s);
	return (
		<>
			<Section id="base-shape" title="Base">
				<Segmented label="Base shape" value={s.baseShape} columns={4} onChange={(id) => setNumber('baseShape')(id)} options={BASE_SHAPES.map((shape) => ({ ...shape, Icon: SHAPE_ICONS[shape.id] }))} />
				<div className="grid grid-cols-3 gap-1.5">
					<NumberField stacked label="Width" value={s.width} min={0.1} max={800} step={1} suffix=" mm" onChange={(v) => setNumber('width')(v)} />
					<NumberField stacked label="Depth" value={s.depth} min={0.1} max={800} step={1} suffix=" mm" onChange={(v) => setNumber('depth')(v)} />
					<NumberField stacked label="Height" value={s.height} min={0.1} max={400} step={0.5} suffix=" mm" onChange={(v) => setNumber('height')(v)} />
				</div>
				{s.baseShape === 'box' && <NumberField label="Corner Radius" value={s.cornerRadius} min={0} max={400} step={0.5} suffix=" mm" onChange={(v) => setNumber('cornerRadius')(v)} />}
				{s.baseShape === 'ngon' && <NumberField label="Sides" value={s.sides} min={3} max={12} hardMax={12} step={1} onChange={(v) => setNumber('sides')(Math.max(3, Math.round(v)))} />}
				{s.baseShape === 'tube' && <NumberField label="Tube Wall" value={s.tubeWall} min={0.2} max={100} step={0.25} suffix=" mm" onChange={(v) => setNumber('tubeWall')(v)} />}
				{['box', 'cylinder', 'ngon'].includes(s.baseShape) && (
					<>
						<NumberField label="Chamfer / Fillet" value={s.chamfer} min={0} max={100} step={0.25} suffix=" mm" onChange={(v) => setNumber('chamfer')(v)} />
						<Checkbox label="Use rounded fillet (more segments)" checked={s.chamferSegments > 1} onChange={(v) => setNumber('chamferSegments')(v ? 4 : 1)} />
					</>
				)}
				{(isFilleted || !['box', 'ngon'].includes(s.baseShape)) && (
					<Group id="base-advanced" title="Advanced">
						{isFilleted && <NumberField label="Fillet Segments" value={s.chamferSegments} min={1} max={16} hardMax={16} step={1} onChange={(v) => setNumber('chamferSegments')(Math.round(v))} />}
						{!['box', 'ngon'].includes(s.baseShape) && <NumberField label="Surface Segments" value={s.radialSegments} min={8} max={128} hardMax={128} step={1} onChange={(v) => setNumber('radialSegments')(Math.round(v))} />}
					</Group>
				)}
			</Section>

			<Section id="shell" title="Shell & Lid" hint={SHELL_SHAPES.includes(s.baseShape) ? null : 'Hollow shells are available for Box, Cylinder and N-gon bases.'}>
				{SHELL_SHAPES.includes(s.baseShape) && (
					<>
						<Checkbox label="Hollow shell" checked={s.shell} onChange={(v) => setNumber('shell')(v)} />
						{shellEnabled(s) && (
							<>
								<NumberField label="Wall Thickness" value={s.wall} min={0.4} max={50} step={0.2} suffix=" mm" onChange={(v) => setNumber('wall')(v)} />
								<Checkbox label="Open top" checked={s.openTop} onChange={(v) => setNumber('openTop')(v)} />
								{s.openTop && <Checkbox label="Add lid" checked={s.lid} onChange={(v) => setNumber('lid')(v)} />}
								{hasLid && (
									<>
										<NumberField label="Lid Thickness" value={s.lidThickness} min={0.4} max={50} step={0.2} suffix=" mm" onChange={(v) => setNumber('lidThickness')(v)} />
										<NumberField label="Lip Depth" value={s.lipDepth} min={0} max={100} step={0.5} suffix=" mm" onChange={(v) => setNumber('lipDepth')(v)} />
										<NumberField label="Lid Clearance" value={s.lidClearance} min={0} max={2} step={0.05} suffix=" mm" onChange={(v) => setNumber('lidClearance')(v)} />
										<p className="text-[11px] leading-relaxed text-neutral-500">Exports lay the lid upside down beside the box, so raised details on the lid top face the bed.</p>
									</>
								)}
							</>
						)}
					</>
				)}
			</Section>
		</>
	);
}

function ObjectsTab({ settings: s, setNumber, setMode, selection, onSelect, addObject, duplicateObjects, removeObjects, uploading }) {
	const hasLid = lidEnabled(s);
	const onAdd = (type) => {
		if (type === 'image') document.getElementById('mask-file-input')?.click();
		else if (type === 'svg') document.getElementById('svg-file-input')?.click();
		else addObject(type);
	};
	return (
		<>
			<Section id="objects-mode" title="Default Mode" hint="Used by every object whose mode is Default.">
				<Segmented label="Default mode" value={s.mode} options={MODES} iconOnly={false} onChange={setMode} />
				{s.mode === 'inset' && <NumberField label="Inset Depth" value={s.insetDepth} min={0.1} max={100} step={0.25} suffix=" mm" onChange={(v) => setNumber('insetDepth')(v)} />}
			</Section>
			<Section id="objects-list" title={`Objects (${s.objects.length})`}>
				<div className="grid grid-cols-5 gap-1">
					{ADD_BUTTONS.map(({ type, label, aria, Icon }) => (
						<button key={type} onClick={() => onAdd(type)} disabled={type === 'image' && uploading} aria-label={aria} title={aria} className="flex flex-col items-center gap-0.5 rounded-md border border-dashed border-neutral-600 px-1 py-1.5 text-[10px] font-medium text-neutral-300 transition hover:border-indigo-500 hover:text-indigo-200 disabled:opacity-40">
							<Icon size={14} />{type === 'image' && uploading ? '…' : label}
						</button>
					))}
				</div>
				<div className="space-y-1">
					{s.objects.map((o) => {
						const label = objectLabel(o);
						const Icon = TYPE_ICONS[o.type] || Type;
						const active = selection.includes(o.id);
						return (
							<div key={o.id} data-testid="object-row" className={`flex items-center gap-1 rounded-md border px-2 py-1 ${active ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-700/60 bg-neutral-800/40 hover:border-neutral-500'}`}>
								<button
									onClick={(event) => onSelect(o.id, event.shiftKey || event.metaKey || event.ctrlKey)}
									aria-label={`Select ${label}`}
									aria-pressed={active}
									className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs text-neutral-200"
									title={`${label} (Shift+click to multi-select)`}
								>
									<Icon size={12} className="shrink-0 text-neutral-500" />
									<span className="truncate">{label}</span>
									{o.target === 'lid' && <span className="shrink-0 text-[10px] text-indigo-300/80">{hasLid ? 'lid' : 'lid (off)'}</span>}
								</button>
								<button onClick={() => duplicateObjects([o.id])} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100" title="Duplicate" aria-label={`Duplicate ${label}`}><Copy size={13} /></button>
								<button onClick={() => removeObjects([o.id])} className="rounded p-0.5 text-neutral-400 hover:bg-red-500/20 hover:text-red-300" title="Delete" aria-label={`Delete ${label}`}><Trash2 size={13} /></button>
							</div>
						);
					})}
				</div>
				<p className="text-[10px] leading-relaxed text-neutral-500">Shift+click selects several · Del deletes · Ctrl+D duplicates · arrows nudge (Shift ×10, Alt ×0.1) · Esc deselects</p>
			</Section>
		</>
	);
}

export default function ScenePanel({
	settings, setNumber, setMode, selection, onSelect, addObject, addImageObject, addSvgObject, duplicateObjects, removeObjects,
	onNewProject, onSaveProject, onLoadProject, onApplyPreset, onExport3MF, onExportSTL,
	building, exporting, error, warning, fontError, ready, inspector, undo, redo, canUndo, canRedo, notice, onDismissNotice,
}) {
	const [tab, setTab] = useState('objects');
	const [fileError, setFileError] = useState(null);
	const [uploading, setUploading] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);
	const primary = selection.at(-1) ?? null;
	const previousPrimary = useRef(primary);

	// On narrow screens the inspector is a tab; jump to it when a new object is selected.
	useEffect(() => {
		if (inspector && primary !== null && primary !== previousPrimary.current) setTab('edit');
		previousPrimary.current = primary;
	}, [primary, inspector]);
	useEffect(() => { if (!inspector && tab === 'edit') setTab('objects'); }, [inspector, tab]);

	const guard = async (action) => {
		setFileError(null);
		setUploading(true);
		try { await action(); } catch (error) { setFileError(error.message || 'Unable to read file.'); } finally { setUploading(false); }
	};

	const tabs = [{ id: 'base', label: 'Base' }, { id: 'objects', label: 'Objects' }, ...(inspector ? [{ id: 'edit', label: 'Edit' }] : [])];

	return (
		<aside className="flex h-[48%] w-full shrink-0 flex-col border-r border-white/10 bg-neutral-900 md:h-full md:w-[300px]">
			<header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
				<Menu label="File" align="left" buttonClassName="grid h-7 w-7 place-items-center rounded-md border border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-indigo-500 hover:text-indigo-200" trigger={<MenuIcon size={14} />}>
					<MenuItem Icon={FilePlus} onClick={onNewProject}>New project</MenuItem>
					<MenuItem Icon={FolderOpen} onClick={() => document.getElementById('project-file-input')?.click()}>Open project…</MenuItem>
					<MenuItem Icon={Save} onClick={onSaveProject}>Save project</MenuItem>
					<MenuLabel>Start from a preset</MenuLabel>
					{PRESETS.map((preset) => <MenuItem key={preset.id} Icon={Sparkles} onClick={() => onApplyPreset(preset.id)}>{preset.label}</MenuItem>)}
				</Menu>
				<h1 className="text-sm font-semibold tracking-tight">Simple 3D</h1>
				{building && (
					<span className="flex items-center gap-1.5 text-[11px] text-neutral-400" title="Building">
						<span className="h-3 w-3 animate-spin rounded-full border border-neutral-500 border-t-indigo-400" />
					</span>
				)}
				<div className="ml-auto flex gap-1">
					<IconButton label="Undo (Ctrl+Z)" Icon={Undo2} onClick={undo} disabled={!canUndo} />
					<IconButton label="Redo (Ctrl+Shift+Z)" Icon={Redo2} onClick={redo} disabled={!canRedo} />
				</div>
			</header>
			<div role="tablist" aria-label="Panels" className="flex border-b border-white/10 px-2">
				{tabs.map(({ id, label }) => (
					<button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 border-b-2 px-2 py-1.5 text-xs font-medium transition ${tab === id ? 'border-indigo-500 text-indigo-100' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}>
						{label}
					</button>
				))}
			</div>

			<div className="panel-scroll flex-1 overflow-y-auto" role="tabpanel">
				{tab === 'base' && <BaseTab settings={settings} setNumber={setNumber} />}
				{tab === 'objects' && <ObjectsTab settings={settings} setNumber={setNumber} setMode={setMode} selection={selection} onSelect={onSelect} addObject={addObject} duplicateObjects={duplicateObjects} removeObjects={removeObjects} uploading={uploading} />}
				{tab === 'edit' && inspector}
			</div>

			<input id="mask-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) guard(async () => addImageObject(await readImageFile(file))); }} />
			<input id="svg-file-input" type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) guard(async () => addSvgObject(await readSvgFile(file))); }} />
			<input id="project-file-input" type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) guard(() => onLoadProject(file)); }} />

			<footer className="space-y-2 border-t border-white/10 px-3 py-2.5">
				{(error || fileError) && <p role="alert" className="rounded bg-red-500/15 px-2 py-1 text-[11px] text-red-300">{error || fileError}</p>}
				{fontError && <p className="rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300">{fontError}</p>}
				{warning && <p role="status" className="rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300">{warning}</p>}
				{notice && (
					<p data-testid="notice" className="flex items-start gap-2 rounded bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-200">
						<span className="flex-1">{notice}</span>
						<button onClick={onDismissNotice} aria-label="Dismiss notice" className="text-indigo-300 hover:text-white"><X size={12} /></button>
					</p>
				)}
				<div className="relative flex">
					<button onClick={onExport3MF} disabled={exporting || !ready || uploading} className="flex-1 rounded-l-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50">
						<Download size={14} className="mr-2 inline" />{exporting ? 'Exporting…' : 'Download .3MF'}
					</button>
					<button onClick={() => setExportOpen(!exportOpen)} aria-label="More export formats" aria-expanded={exportOpen} className="rounded-r-md border-l border-indigo-800 bg-indigo-600 px-2 text-white hover:bg-indigo-500"><ChevronDown size={14} /></button>
					{/* Kept in the DOM while closed so the STL export stays scriptable. */}
					<div className={`absolute bottom-full right-0 mb-1 w-44 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl ${exportOpen ? '' : 'hidden'}`}>
						<button onClick={() => { setExportOpen(false); onExportSTL(); }} disabled={exporting || !ready || uploading} className="w-full px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40">Download .STL</button>
					</div>
				</div>
			</footer>
		</aside>
	);
}
