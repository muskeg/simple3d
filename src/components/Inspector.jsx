import { useState } from 'react';
import NumberField, { VectorField } from './NumberField.jsx';
import { Section, Group, Checkbox, Select, Segmented, IconButton } from './ui.jsx';
import { TYPE_ICONS, MODES, readImageFile, readSvgFile } from './ScenePanel.jsx';
import { rotateAboutWorldAxis } from '../lib/placement.js';
import { fontOptions } from '../lib/fonts.js';
import { SHAPE_KINDS } from '../lib/shapes2d.js';
import { OBJECT_MODES, HOLE_HEADS, effectiveMode, objectLabel } from '../lib/objects.js';
import { lidEnabled } from '../lib/bodies.js';
import { MAX_TEXT_LENGTH } from '../lib/project.js';
import { ARRAY_KINDS, MAX_ARRAY_INSTANCES } from '../lib/arrays.js';
import { Copy, Trash2, Upload, Circle, RectangleHorizontal, Star, Heart, Hexagon, ArrowRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignHorizontalDistributeCenter, MoveHorizontal, MoveVertical, Crosshair, Type, Minus, Columns3, LayoutGrid, RotateCw } from 'lucide-react';

const ARRAY_ICONS = { none: Minus, linear: Columns3, grid: LayoutGrid, circular: RotateCw };

const FACE_BUTTONS = ['top', 'bottom', 'front', 'back', 'left', 'right'];
const SHAPE_ICONS = { circle: Circle, rect: RectangleHorizontal, star: Star, heart: Heart, polygon: Hexagon, arrow: ArrowRight };
const TEXT_ALIGN = [
	{ id: 'left', label: 'Align left', Icon: AlignStartVertical },
	{ id: 'center', label: 'Align center', Icon: AlignCenterVertical },
	{ id: 'right', label: 'Align right', Icon: AlignEndVertical },
];
const AXES = [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }];

function FileButton({ id, label, accept, onFile }) {
	return (
		<>
			<button onClick={() => document.getElementById(id)?.click()} className="rounded-md border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 transition hover:border-indigo-500 hover:text-indigo-200">{label}</button>
			<input id={id} type="file" accept={accept} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }} />
		</>
	);
}

function SelectionTools({ objects, onAlign, onDistribute, duplicateObjects, removeObjects }) {
	const [axis, setAxis] = useState('x');
	const ids = objects.map((object) => object.id);
	return (
		<Section id="insp-selection" title={`${objects.length} objects selected`}>
			<div className="flex items-center gap-2">
				<span className="text-xs text-neutral-400">Axis</span>
				<div className="flex-1"><Segmented label="Align axis" value={axis} options={AXES} iconOnly onChange={setAxis} /></div>
			</div>
			<div className="grid grid-cols-4 gap-1">
				<IconButton label={`Align ${axis.toUpperCase()} min`} Icon={AlignStartVertical} onClick={() => onAlign(ids, axis, 'min')} />
				<IconButton label={`Align ${axis.toUpperCase()} center`} Icon={AlignCenterVertical} onClick={() => onAlign(ids, axis, 'center')} />
				<IconButton label={`Align ${axis.toUpperCase()} max`} Icon={AlignEndVertical} onClick={() => onAlign(ids, axis, 'max')} />
				<IconButton label={`Distribute along ${axis.toUpperCase()}`} Icon={AlignHorizontalDistributeCenter} disabled={objects.length < 3} onClick={() => onDistribute(ids, axis)} />
			</div>
			<div className="flex gap-1">
				<button onClick={() => duplicateObjects(ids)} className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500">Duplicate all</button>
				<button onClick={() => removeObjects(ids)} className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/50 px-2 py-1 text-xs text-red-300 hover:border-red-500/60">Delete all</button>
			</div>
		</Section>
	);
}

export default function Inspector({
	settings: s, selection, updateObject, duplicateObjects, removeObjects, snapToFace, setObjectTarget, setObjectImage, setObjectSvg,
	addCustomFont, onAlign, onDistribute, onCenterOnFace, onCenterOnBody, explodeArray, prefs, setPrefs, className = '',
}) {
	const objects = selection.map((id) => s.objects.find((object) => object.id === id)).filter(Boolean);
	const selected = objects.at(-1) || null;
	const [axis, setAxis] = useState('y');
	const [axisAngle, setAxisAngle] = useState(90);
	const [axisVector, setAxisVector] = useState({ x: 1, y: 1, z: 0 });
	const [axisError, setAxisError] = useState(null);
	const [fileError, setFileError] = useState(null);

	if (!selected) {
		return (
			<div className={`flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-neutral-500 ${className}`}>
				<Type size={18} className="text-neutral-600" />
				<p>Select an object to edit it.</p>
				<p className="text-[11px]">Shift+click in the list or viewport to select several and align them.</p>
			</div>
		);
	}

	const mode = effectiveMode(selected, s);
	const hasLid = lidEnabled(s);
	const Icon = TYPE_ICONS[selected.type] || Type;
	const update = (patch) => updateObject(selected.id, patch);
	const guard = async (action) => {
		setFileError(null);
		try { await action(); } catch (error) { setFileError(error.message || 'Unable to read file.'); }
	};
	const applyAxisAngle = () => {
		const value = Number(axisAngle);
		if (!Number.isFinite(value)) return;
		try {
			const { rot } = rotateAboutWorldAxis(selected.rot, axis === 'custom' ? axisVector : axis, value);
			update({ rot, face: 'auto' });
			setAxisError(null);
		} catch (error) { setAxisError(error.message); }
	};

	return (
		<div className={className}>
			{objects.length > 1 && <SelectionTools objects={objects} onAlign={onAlign} onDistribute={onDistribute} duplicateObjects={duplicateObjects} removeObjects={removeObjects} />}

			<div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
				<Icon size={14} className="shrink-0 text-indigo-300" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100" title={objectLabel(selected)}>{objectLabel(selected)}</span>
				<IconButton label="Duplicate selected" Icon={Copy} onClick={() => duplicateObjects([selected.id])} />
				<IconButton label="Delete selected" Icon={Trash2} onClick={() => removeObjects([selected.id])} />
			</div>
			{fileError && <p role="alert" className="mx-3 mt-2 rounded bg-red-500/15 px-2 py-1 text-[11px] text-red-300">{fileError}</p>}

			<Section id="insp-object" title="Object">
				{(hasLid || selected.target === 'lid') && (
					<Select label="Body" value={selected.target === 'lid' ? 'lid' : 'base'} onChange={(target) => setObjectTarget(selected.id, target)} options={[{ id: 'base', label: 'Base' }, { id: 'lid', label: hasLid ? 'Lid' : 'Lid (disabled)' }]} />
				)}
				{selected.type !== 'hole' && (
					<Select label="Object Mode" value={selected.mode || 'inherit'} onChange={(value) => update({ mode: value })} options={OBJECT_MODES.map((m) => (m.id === 'inherit' ? { ...m, label: `Default (${MODES.find((g) => g.id === s.mode)?.label})` } : m))} />
				)}

				{selected.type === 'text' && (
					<>
						<label className="block text-xs text-neutral-300">
							<span className="mb-1 block text-neutral-400">Text</span>
							<textarea value={selected.text} rows={Math.min(4, Math.max(1, selected.text.split('\n').length))} onChange={(e) => update({ text: e.target.value })} maxLength={MAX_TEXT_LENGTH} placeholder="Type something" className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm outline-none focus:border-indigo-500" />
						</label>
						<div className="flex items-end gap-1.5">
							<div className="min-w-0 flex-1"><Select label="Font" value={selected.font || s.font} onChange={(font) => update({ font })} options={fontOptions(s)} /></div>
							<IconButton label="Upload font" Icon={Upload} onClick={() => document.getElementById('font-file-input')?.click()} />
							<input id="font-file-input" type="file" accept=".ttf,.otf,font/ttf,font/otf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) guard(() => addCustomFont(file, selected.id)); }} />
						</div>
						<Segmented label="Text alignment" value={selected.align || 'center'} options={TEXT_ALIGN} iconOnly onChange={(value) => update({ align: value })} />
						<NumberField label="Letter Spacing" value={selected.letterSpacing ?? 0} min={-50} max={100} step={0.1} suffix=" mm" onChange={(v) => update({ letterSpacing: v })} />
						{selected.text.includes('\n') && <NumberField label="Line Spacing" value={selected.lineHeight ?? 1} min={0.5} max={3} hardMax={3} step={0.05} onChange={(v) => update({ lineHeight: Math.max(0.5, v) })} />}
					</>
				)}

				{selected.type === 'image' && (
					<>
						<div className="flex items-center gap-2">
							{selected.image && <img src={selected.image} alt="mask" className="h-10 w-10 rounded border border-neutral-700 bg-neutral-800 object-contain" />}
							<FileButton id={`replace-img-${selected.id}`} label="Replace Image…" accept="image/png,image/jpeg,image/webp,image/gif" onFile={(file) => guard(async () => setObjectImage(selected.id, await readImageFile(file)))} />
						</div>
						<Select label="Mask Channel" value={selected.maskChannel || 'alpha'} onChange={(value) => update({ maskChannel: value })} options={[{ id: 'alpha', label: 'Alpha' }, { id: 'dark', label: 'Dark pixels' }, { id: 'light', label: 'Light pixels' }]} />
						<NumberField label="Mask Threshold" value={selected.threshold ?? 128} min={1} max={255} hardMax={255} step={1} onChange={(v) => update({ threshold: Math.round(v) })} />
					</>
				)}

				{selected.type === 'svg' && (
					<div className="flex items-center gap-2">
						{/* Rendered through <img>, where SVG scripts never run. */}
						<img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(selected.svg || '')}`} alt="svg outline" className="h-10 w-10 rounded border border-neutral-700 bg-neutral-200 object-contain" />
						<FileButton id={`replace-svg-${selected.id}`} label="Replace SVG…" accept=".svg,image/svg+xml" onFile={(file) => guard(async () => setObjectSvg(selected.id, await readSvgFile(file)))} />
					</div>
				)}

				{selected.type === 'shape' && (
					<>
						<Segmented label="Shape Kind" value={selected.shape || 'circle'} columns={6} iconOnly onChange={(shape) => update({ shape })} options={SHAPE_KINDS.map((kind) => ({ ...kind, Icon: SHAPE_ICONS[kind.id] }))} />
						<div className="grid grid-cols-2 gap-1.5">
							<NumberField stacked label="Shape Width" value={selected.fontSize} min={1} max={300} step={0.5} suffix=" mm" onChange={(v) => update({ fontSize: v })} />
							<NumberField stacked label="Shape Height" value={selected.shapeHeight ?? selected.fontSize} min={0.5} max={300} step={0.5} suffix=" mm" onChange={(v) => update({ shapeHeight: v })} />
						</div>
						{['star', 'polygon'].includes(selected.shape) && <NumberField label={selected.shape === 'star' ? 'Star Points' : 'Polygon Sides'} value={selected.sides ?? 5} min={3} max={24} hardMax={24} step={1} onChange={(v) => update({ sides: Math.max(3, Math.round(v)) })} />}
						{selected.shape === 'star' && <NumberField label="Inner Ratio" value={selected.innerRatio ?? 0.5} min={0.1} max={0.95} hardMax={0.95} step={0.05} onChange={(v) => update({ innerRatio: Math.max(0.1, v) })} />}
						{selected.shape === 'rect' && <NumberField label="Shape Corner Radius" value={selected.cornerRadius ?? 0} min={0} max={150} step={0.5} suffix=" mm" onChange={(v) => update({ cornerRadius: v })} />}
					</>
				)}

				{selected.type === 'hole' ? (
					<>
						<NumberField label="Hole Diameter" value={selected.holeDiameter ?? 5} min={0.2} max={200} step={0.1} suffix=" mm" onChange={(v) => update({ holeDiameter: v })} />
						<Select label="Hole Head" value={selected.head || 'none'} onChange={(head) => update({ head })} options={HOLE_HEADS} />
						{selected.head && selected.head !== 'none' && <NumberField label="Head Diameter" value={selected.headDiameter ?? 10} min={0.2} max={300} step={0.1} suffix=" mm" onChange={(v) => update({ headDiameter: v })} />}
						{selected.head === 'counterbore' && <NumberField label="Head Depth" value={selected.headDepth ?? 3} min={0.1} max={100} step={0.1} suffix=" mm" onChange={(v) => update({ headDepth: v })} />}
						<p className="text-[11px] leading-relaxed text-neutral-500">Cuts straight through its body along the object axis, including inlays and raised objects.</p>
					</>
				) : (
					<>
						{selected.type !== 'shape' && <NumberField label={{ image: 'Mask Width', svg: 'SVG Width' }[selected.type] || 'Font Size'} value={selected.fontSize} min={1} max={300} step={0.5} suffix=" mm" onChange={(v) => update({ fontSize: v })} />}
						{mode === 'flush_inlay' && <NumberField label="Inlay Depth" value={selected.inlayDepth ?? 2} min={0.1} max={100} step={0.25} suffix=" mm" onChange={(v) => update({ inlayDepth: v })} />}
						{mode === 'inset' && <NumberField label="Object Inset Depth" value={selected.insetDepth ?? s.insetDepth} min={0.1} max={100} step={0.25} suffix=" mm" onChange={(v) => update({ insetDepth: v })} />}
						{mode === 'raised' && <NumberField label="Extrusion Height" value={selected.extrudeHeight} min={0.1} max={200} step={0.25} suffix=" mm" onChange={(v) => update({ extrudeHeight: v })} />}
						<Checkbox label="Mirror (for stamps)" checked={selected.mirror} onChange={(mirror) => update({ mirror })} />
					</>
				)}
				{(selected.type === 'text' || selected.type === 'image') && (
					<Group id="insp-advanced" title="Advanced">
						{selected.type === 'text' && <NumberField label="Curve Segments" value={selected.curveSegments} min={2} max={32} hardMax={32} step={1} onChange={(v) => update({ curveSegments: Math.round(v) })} />}
						{selected.type === 'image' && <NumberField label="Mask Resolution" value={selected.maskResolution ?? 256} min={64} max={1024} hardMax={1024} step={32} onChange={(v) => update({ maskResolution: Math.round(v) })} />}
					</Group>
				)}
			</Section>

			<Section id="insp-array" title="Array" defaultOpen={false}>
				<Segmented label="Array type" value={selected.arrayKind || 'none'} iconOnly onChange={(arrayKind) => update({ arrayKind })} options={ARRAY_KINDS.map((kind) => ({ ...kind, Icon: ARRAY_ICONS[kind.id] }))} />
				{(selected.arrayKind || 'none') !== 'none' && (
					<>
						<NumberField label="Count" value={selected.arrayCount ?? 3} min={1} max={50} hardMax={MAX_ARRAY_INSTANCES} step={1} onChange={(v) => update({ arrayCount: Math.max(1, Math.round(v)) })} />
						{selected.arrayKind === 'circular' ? (
							<>
								<NumberField label="Array Radius" value={selected.arrayRadius ?? 20} min={0.1} max={500} step={0.5} suffix=" mm" onChange={(v) => update({ arrayRadius: Math.max(0.1, v) })} />
								<NumberField label="Sweep" value={selected.arraySweep ?? 360} min={1} max={360} hardMax={360} step={5} suffix="°" onChange={(v) => update({ arraySweep: Math.max(1, v) })} />
								<Checkbox label="Rotate copies" checked={selected.arrayRotate !== false} onChange={(arrayRotate) => update({ arrayRotate })} />
							</>
						) : (
							<NumberField label="Spacing" value={selected.arraySpacing ?? 20} min={-500} max={500} step={0.5} suffix=" mm" onChange={(v) => update({ arraySpacing: v })} />
						)}
						{selected.arrayKind === 'grid' && (
							<>
								<NumberField label="Rows" value={selected.arrayRows ?? 2} min={1} max={50} hardMax={MAX_ARRAY_INSTANCES} step={1} onChange={(v) => update({ arrayRows: Math.max(1, Math.round(v)) })} />
								<NumberField label="Row Spacing" value={selected.arrayRowSpacing ?? 20} min={-500} max={500} step={0.5} suffix=" mm" onChange={(v) => update({ arrayRowSpacing: v })} />
							</>
						)}
						<p className="text-[11px] leading-relaxed text-neutral-500">Copies step along the object's own surface plane (circular copies orbit a center below it) and may lift off curved surfaces.</p>
						<button onClick={() => explodeArray(selected.id)} className="w-full rounded-md border border-neutral-700 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500">Convert to separate objects</button>
					</>
				)}
			</Section>

			<Section id="insp-placement" title="Placement">
				<div>
					<p className="mb-1 text-[11px] text-neutral-500">Snap to face</p>
					<div className="grid grid-cols-3 gap-1">
						{FACE_BUTTONS.map((face) => (
							<button key={face} onClick={() => snapToFace(selected.id, face)} aria-pressed={selected.face === face} className={`rounded-md border px-2 py-1 text-xs capitalize transition ${selected.face === face ? 'border-indigo-500 bg-indigo-500/15 text-indigo-100' : 'border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:border-neutral-500'}`}>{face}</button>
						))}
					</div>
				</div>
				<div className="flex items-center gap-1">
					<span className="flex-1 text-[11px] text-neutral-500">Center on face</span>
					<IconButton label="Center across face" Icon={MoveHorizontal} onClick={() => onCenterOnFace(selected.id, ['across'])} />
					<IconButton label="Center up face" Icon={MoveVertical} onClick={() => onCenterOnFace(selected.id, ['up'])} />
					<IconButton label="Center on face" Icon={Crosshair} onClick={() => onCenterOnFace(selected.id, ['across', 'up'])} />
				</div>
				<div className="flex items-center gap-1">
					<span className="flex-1 text-[11px] text-neutral-500">Center on body</span>
					{AXES.map(({ id }) => <button key={id} onClick={() => onCenterOnBody(selected.id, id)} aria-label={`Center on body ${id.toUpperCase()}`} title={`Center on body ${id.toUpperCase()}`} className="h-7 w-7 rounded-md border border-neutral-700/70 bg-neutral-800/40 text-[11px] text-neutral-300 hover:border-neutral-500">{id.toUpperCase()}</button>)}
				</div>
				<Group id="insp-transform" title="Transform">
					<VectorField label="Position (mm)" ariaPrefix="Position" value={selected.pos} onChange={(key, value) => update({ pos: { ...selected.pos, [key]: value }, face: 'auto' })} />
					<VectorField label="Rotation (°)" ariaPrefix="Rotation" value={selected.rot} step={1} min={-360} max={360} onChange={(key, value) => update({ rot: { ...selected.rot, [key]: value }, face: 'auto' })} />
					<div className="flex items-center gap-1.5">
						<select aria-label="Rotation axis" value={axis} onChange={(e) => setAxis(e.target.value)} className="rounded-md border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs outline-none focus:border-indigo-500">
							<option value="x">Axis X</option>
							<option value="y">Axis Y</option>
							<option value="z">Axis Z</option>
							<option value="custom">Custom axis</option>
						</select>
						<input type="number" aria-label="Rotation angle" value={axisAngle} step={1} onChange={(e) => setAxisAngle(e.target.value)} className="w-14 rounded-md border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-right text-xs tabular-nums outline-none focus:border-indigo-500" />
						<span className="text-[11px] text-neutral-500">°</span>
						<button onClick={applyAxisAngle} className="ml-auto rounded-md border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200 transition hover:border-indigo-500 hover:text-indigo-200">Apply</button>
					</div>
					{axis === 'custom' && <div className="grid grid-cols-3 gap-1.5">{['x', 'y', 'z'].map((component) => <label key={component} className="text-[10px] text-neutral-400">{component.toUpperCase()}<input aria-label={`Axis ${component.toUpperCase()}`} type="number" value={axisVector[component]} onChange={(event) => setAxisVector({ ...axisVector, [component]: Number(event.target.value) })} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-800 p-1 text-xs" /></label>)}</div>}
					{axisError && <p role="alert" className="text-xs text-red-300">{axisError}</p>}
					<div className="grid grid-cols-2 gap-1.5 border-t border-white/5 pt-2">
						<NumberField stacked label="Grid Step" value={prefs.gridStep} min={0.05} max={50} step={0.05} suffix=" mm" onChange={(v) => setPrefs({ ...prefs, gridStep: Math.max(0.05, v) })} />
						<NumberField stacked label="Angle Step" value={prefs.angleStep} min={1} max={90} hardMax={90} step={1} suffix="°" onChange={(v) => setPrefs({ ...prefs, angleStep: Math.max(1, v) })} />
					</div>
				</Group>
			</Section>
		</div>
	);
}
