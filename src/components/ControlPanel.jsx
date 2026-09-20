import React from 'react';
import NumberField from './NumberField.jsx';
import { rotateAboutWorldAxis } from '../lib/placement.js';
import { BASE_SHAPES } from '../lib/baseShapes.js';
import { FONTS } from '../lib/fonts.js';
import { Copy, Trash2, Image, Type, Download } from 'lucide-react';

function Section({ title, children, hint }) {
	return (
		<section className="border-b border-white/5 px-4 py-4">
			<h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-indigo-300/80">
				{title}
			</h2>
			{hint && <p className="mb-3 text-xs leading-relaxed text-neutral-500">{hint}</p>}
			<div className="space-y-3.5">{children}</div>
		</section>
	);
}

const MODES = [
	{ id: 'raised', label: 'Raised', desc: 'Objects sit proud of the surface' },
	{ id: 'inset', label: 'Inset', desc: 'Objects carved into the surface' },
	{ id: 'flush_inlay', label: 'Flush Inlay', desc: 'Carved + separate inlay piece' },
];

const FACE_BUTTONS = ['top', 'bottom', 'front', 'back', 'left', 'right'];

function readFileAsDataURL(file) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = reject;
		r.readAsDataURL(file);
	});
}

export default function ControlPanel({
	settings,
	setNumber,
	setMode,
	updateObject,
	addObject,
	addImageObject,
	setObjectImage,
	duplicateObject,
	removeObject,
	snapToFace,
	selectedId,
	setSelectedId,
	onExport3MF,
	onExportSTL,
	building,
	exporting,
	error,
	fontError,
	ready,
}) {
	const s = settings;
	const isFilleted = s.chamfer > 0 && s.chamferSegments > 1;
	const selected = s.objects.find((o) => o.id === selectedId) || null;
	const [fileError, setFileError] = React.useState(null);
	const [uploading, setUploading] = React.useState(false);

	// Local axis+angle scratch state (applied on demand).
	const [axis, setAxis] = React.useState('y');
	const [axisAngle, setAxisAngle] = React.useState(90);
	const [axisVector, setAxisVector] = React.useState({ x: 1, y: 1, z: 0 });
	const [axisError, setAxisError] = React.useState(null);

	const applyAxisAngle = () => {
		if (!selected) return;
		const v = Number(axisAngle);
		if (!Number.isFinite(v)) return;
		try {
			const { rot } = rotateAboutWorldAxis(selected.rot, axis === 'custom' ? axisVector : axis, v);
			updateObject(selected.id, { rot, face: 'auto' });
			setAxisError(null);
		} catch (error) { setAxisError(error.message); }
	};

	const onPickImage = async (file, targetId = null) => {
		if (!file) return;
		setFileError(null);
		setUploading(true);
		try {
			if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
			if (file.size > 20 * 1024 * 1024) throw new Error('Image exceeds the 20 MB limit.');
			const dataURL = await readFileAsDataURL(file);
			if (targetId) await setObjectImage(targetId, dataURL);
			else await addImageObject(dataURL);
		} catch (error) {
			setFileError(error.message || 'Unable to read image.');
		} finally {
			setUploading(false);
		}
	};

	return (
		<aside className="flex h-[48%] w-full md:h-full md:w-[340px] shrink-0 flex-col border-r border-white/10 bg-neutral-900">
			<header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
				<div className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
				<h1 className="text-sm font-semibold tracking-tight">Simple 3D Generator</h1>
				{building && (
					<span className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-400">
						<span className="h-3 w-3 animate-spin rounded-full border border-neutral-500 border-t-indigo-400" />
						Building
					</span>
				)}
			</header>

			<div className="panel-scroll flex-1 overflow-y-auto">
				<Section title="Base Plate">
					<div>
						<label className="mb-1.5 block text-[11px] text-neutral-400">Shape</label>
						<div className="grid grid-cols-5 gap-1">
							{BASE_SHAPES.map((sh) => (
								<button
									key={sh.id}
									onClick={() => setNumber('baseShape')(sh.id)}
									className={`rounded-md border px-1 py-1.5 text-[10px] leading-tight transition-colors ${
										s.baseShape === sh.id
											? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
											: 'border-neutral-700/60 bg-neutral-800/40 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
									}`}
									title={sh.label}
								>
									{sh.label}
								</button>
							))}
						</div>
					</div>
					<NumberField label="Width" value={s.width} min={0.1} max={800} step={1} suffix=" mm" onChange={(v) => setNumber('width')(v)} />
					<NumberField label="Depth" value={s.depth} min={0.1} max={800} step={1} suffix=" mm" onChange={(v) => setNumber('depth')(v)} />
					<NumberField label="Height" value={s.height} min={0.1} max={400} step={0.5} suffix=" mm" onChange={(v) => setNumber('height')(v)} />
					{s.baseShape === 'box' && (
						<NumberField label="Corner Radius" value={s.cornerRadius} min={0} max={400} step={0.5} suffix=" mm" onChange={(v) => setNumber('cornerRadius')(v)} />
					)}
					{(s.baseShape === 'box' || s.baseShape === 'cylinder') && (
						<>
							<NumberField label="Chamfer / Fillet" value={s.chamfer} min={0} max={100} step={0.25} suffix=" mm" onChange={(v) => setNumber('chamfer')(v)} />
							{isFilleted && (
								<NumberField label="Fillet Segments" value={s.chamferSegments} min={1} max={16} hardMax={16} step={1} onChange={(v) => setNumber('chamferSegments')(Math.round(v))} />
							)}
							{(
								<label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
									<input
										type="checkbox"
										checked={s.chamferSegments > 1}
										onChange={(e) => setNumber('chamferSegments')(e.target.checked ? 4 : 1)}
										className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 accent-indigo-500"
									/>
									Use rounded fillet (more segments)
								</label>
							)}
						</>
					)}
					{s.baseShape !== 'box' && (
						<NumberField
							label="Surface Segments"
							value={s.radialSegments}
							min={8}
							max={128}
							hardMax={128}
							step={1}
							onChange={(v) => setNumber('radialSegments')(Math.round(v))}
						/>
					)}
				</Section>

				<Section
					title="Objects"
				>
					{/* Object list */}
					<div className="space-y-1">
						{s.objects.map((o) => (
							<div
								key={o.id}
								data-testid="object-row"
								className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${
									selected?.id === o.id
										? 'border-indigo-500 bg-indigo-500/10'
										: 'border-neutral-700/60 bg-neutral-800/40 hover:border-neutral-500'
								}`}
							>
								<button
									onClick={() => setSelectedId(o.id)}
									aria-label={`Select ${o.text || 'empty text'}`}
									aria-pressed={selectedId === o.id}
									className="min-w-0 flex-1 truncate text-left text-xs text-neutral-200"
									title={o.text}
								>
									{o.type === 'image' && <Image size={12} className="mr-1 inline" />}
									{o.text || `Object ${o.id}`}
								</button>
								<button
									onClick={() => duplicateObject(o.id)}
									className="rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
									title="Duplicate"
									aria-label={`Duplicate ${o.text || 'object'}`}
								>
									<Copy size={14} />
								</button>
								<button
									onClick={() => removeObject(o.id)}
									className="rounded px-1 text-[11px] text-neutral-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30"
									title="Delete"
									aria-label={`Delete ${o.text || 'object'}`}
								>
									<Trash2 size={14} />
								</button>
							</div>
						))}
					</div>

					<div className="flex gap-2">
						<button
							onClick={() => addObject('text')}
							className="flex-1 rounded-md border border-dashed border-neutral-600 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-indigo-500 hover:text-indigo-200"
						>
							<Type size={14} className="mr-1 inline" /> Add Text Object
						</button>
						<button
							onClick={() => document.getElementById('mask-file-input')?.click()}
							disabled={uploading}
							className="flex-1 rounded-md border border-dashed border-neutral-600 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-indigo-500 hover:text-indigo-200"
						>
							<Image size={14} className="mr-1 inline" /> {uploading ? 'Loading...' : 'Add Image Mask'}
						</button>
						<input
							id="mask-file-input"
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							className="hidden"
							onChange={(e) => {
								onPickImage(e.target.files?.[0]);
								e.target.value = '';
							}}
						/>
					</div>

					{selected && (
						<div key={selected.id} className="space-y-3.5 border-t border-neutral-700/60 pt-3">
							{selected.type === 'text' && <label className="block text-xs text-neutral-300">Font
								<select aria-label="Font" value={selected.font || s.font} onChange={(event) => updateObject(selected.id, { font: event.target.value })} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5">
									{FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
								</select>
							</label>}
							{selected.type === 'text' && (
								<label className="block text-xs text-neutral-300">
									<span className="mb-1 block">Text</span>
									<input
										type="text"
										value={selected.text}
										onChange={(e) => updateObject(selected.id, { text: e.target.value })}
										maxLength={256}
										placeholder="Type something"
										className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
									/>
								</label>
							)}
						{selected.type === 'image' && (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									{selected.image && (
										<img
											src={selected.image}
											alt="mask"
											className="h-10 w-10 rounded border border-neutral-700 bg-neutral-800 object-contain"
										/>
									)}
									<button
										onClick={() => document.getElementById(`replace-img-${selected.id}`)?.click()}
										className="rounded-md border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 transition hover:border-indigo-500 hover:text-indigo-200"
									>
										Replace Image…
									</button>
									<input
										id={`replace-img-${selected.id}`}
										type="file"
										accept="image/png,image/jpeg,image/webp,image/gif"
										className="hidden"
										onChange={(e) => {
											onPickImage(e.target.files?.[0], selected.id);
											e.target.value = '';
										}}
									/>
								</div>
								<label className="block text-xs text-neutral-300">Mask Channel
									<select aria-label="Mask Channel" value={selected.maskChannel || 'alpha'} onChange={(event) => updateObject(selected.id, { maskChannel: event.target.value })} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5">
										<option value="alpha">Alpha</option><option value="dark">Dark pixels</option><option value="light">Light pixels</option>
									</select>
								</label>
								<NumberField label="Mask Threshold" value={selected.threshold ?? 128} min={1} max={255} hardMax={255} step={1} onChange={(v) => updateObject(selected.id, { threshold: Math.round(v) })} />
								<NumberField label="Mask Resolution" value={selected.maskResolution ?? 256} min={64} max={1024} hardMax={1024} step={32} onChange={(v) => updateObject(selected.id, { maskResolution: Math.round(v) })} />
							</div>
						)}
						<NumberField label={selected.type === 'image' ? 'Mask Width' : 'Font Size'} value={selected.fontSize} min={1} max={300} step={0.5} suffix=" mm" onChange={(v) => updateObject(selected.id, { fontSize: v })} />
							<NumberField label="Extrusion Height" value={selected.extrudeHeight} min={0.1} max={200} step={0.25} suffix=" mm" onChange={(v) => updateObject(selected.id, { extrudeHeight: v })} />
							{selected.type === 'text' && <NumberField label="Curve Segments" value={selected.curveSegments} min={2} max={32} hardMax={32} step={1} onChange={(v) => updateObject(selected.id, { curveSegments: Math.round(v) })} />}

							<div className="border-t border-white/5 pt-3">
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">Position (mm)</p>
								{['x', 'y', 'z'].map((axis) => <NumberField key={axis} label={axis.toUpperCase()} ariaLabel={`Position ${axis.toUpperCase()}`} value={selected.pos[axis]} min={-1000} max={1000} step={0.5} onChange={(value) => updateObject(selected.id, { pos: { ...selected.pos, [axis]: value }, face: 'auto' })} />)}
							</div>

							<div className="border-t border-white/5 pt-3">
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">Rotation (°)</p>
								{['x', 'y', 'z'].map((axis) => <NumberField key={axis} label={axis.toUpperCase()} ariaLabel={`Rotation ${axis.toUpperCase()}`} value={selected.rot[axis]} min={-360} max={360} step={1} onChange={(value) => updateObject(selected.id, { rot: { ...selected.rot, [axis]: value }, face: 'auto' })} />)}

								{/* Axis + angle (world axis) */}
								<div className="mt-2 flex items-center gap-2">
									<select
										aria-label="Rotation axis"
										value={axis}
										onChange={(e) => setAxis(e.target.value)}
										className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs outline-none focus:border-indigo-500"
									>
										<option value="x">Axis X</option>
										<option value="y">Axis Y</option>
										<option value="z">Axis Z</option>
										<option value="custom">Custom axis</option>
									</select>
									<input
										type="number"
										aria-label="Rotation angle"
										value={axisAngle}
										step={1}
										onChange={(e) => setAxisAngle(e.target.value)}
										className="w-16 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-indigo-500"
									/>
									<span className="text-[11px] text-neutral-500">°</span>
									<button
										onClick={applyAxisAngle}
										className="ml-auto rounded-md border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 transition hover:border-indigo-500 hover:text-indigo-200"
									>
										Apply
									</button>
								</div>
								{axis === 'custom' && <div className="mt-2 grid grid-cols-3 gap-2">{['x', 'y', 'z'].map((component) => <label key={component} className="text-xs text-neutral-400">{component.toUpperCase()}<input aria-label={`Axis ${component.toUpperCase()}`} type="number" value={axisVector[component]} onChange={(event) => setAxisVector({ ...axisVector, [component]: Number(event.target.value) })} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 p-1" /></label>)}</div>}
								{axisError && <p role="alert" className="text-xs text-red-300">{axisError}</p>}
							</div>

							<div className="border-t border-white/5 pt-3">
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">Snap to Face</p>
								<div className="grid grid-cols-3 gap-1.5">
									{FACE_BUTTONS.map((f) => (
										<button
											key={f}
											onClick={() => snapToFace(selected.id, f)}
											className={`rounded-md border px-2 py-1 text-xs capitalize transition ${
												selected.face === f
													? 'border-indigo-500 bg-indigo-500/15 text-indigo-100'
													: 'border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:border-neutral-500'
											}`}
										>
											{f}
										</button>
									))}
								</div>
							</div>
						</div>
					)}
				</Section>

				<Section
					title="Operation Mode"
				>
					<div className="grid grid-cols-1 gap-2">
						{MODES.map((m) => (
							<button
								key={m.id}
								onClick={() => setMode(m.id)}
								className={`rounded-md border px-3 py-2 text-left transition ${
									s.mode === m.id
										? 'border-indigo-500 bg-indigo-500/15 text-indigo-100'
										: 'border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:border-neutral-500'
								}`}
							>
								<div className="text-sm font-medium">{m.label}</div>
							</button>
						))}
					</div>
					{s.mode === 'inset' && (
						<NumberField label="Inset Depth" value={s.insetDepth} min={0.1} max={100} step={0.25} suffix=" mm" onChange={(v) => setNumber('insetDepth')(v)} />
					)}
				</Section>
			</div>

			<footer className="space-y-2 border-t border-white/10 px-4 py-3">
				{(error || fileError) && <p role="alert" className="rounded bg-red-500/15 px-2 py-1 text-[11px] text-red-300">{error || fileError}</p>}
				{fontError && <p className="rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300">{fontError}</p>}
				<button
					onClick={onExport3MF}
					disabled={exporting || !ready || uploading}
					className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
				>
					<Download size={14} className="mr-2 inline" />{exporting ? 'Exporting…' : 'Download .3MF'}
				</button>
				<button
					onClick={onExportSTL}
					disabled={exporting || !ready || uploading}
					className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
				>
					Download .STL
				</button>
			</footer>
		</aside>
	);
}
