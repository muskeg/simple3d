import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { Move3D, Rotate3D, Magnet, Maximize, Blend, PackageOpen, Grid3x3 } from 'lucide-react';
import { disposeGroup } from '../lib/csg.js';
import { placeObject } from '../lib/csg.js';
import { createBodyGeometry, lidEnabled } from '../lib/bodies.js';
import { createObjectGeometry, objectBody } from '../lib/objects.js';
import { quaternionFromRot, rotFromQuaternion, surfacePlacement } from '../lib/placement.js';
import { snapToGrid } from '../lib/align.js';
import { arrayInstances } from '../lib/arrays.js';
import BuildStatus from './BuildStatus.jsx';

export default function Viewport({ model, onModelRef, settings, fonts, selection, onSelect, onUpdate, prefs, onToggleGridSnap, status }) {
	const selectedId = selection.at(-1) ?? null;
	const mountRef = useRef(null);
	const axisRef = useRef(null);
	const threeRef = useRef(null);
	const modelContainerRef = useRef(null);
	const latest = useRef(null);
	const [mode, setMode] = useState('translate');
	const [snap, setSnap] = useState(true);
	const [transparentBase, setTransparentBase] = useState(true);
	const [printLayout, setPrintLayout] = useState(false);
	const [viewportError, setViewportError] = useState(null);
	const hasLid = lidEnabled(settings);
	const showLayout = printLayout && hasLid;
	latest.current = { settings, fonts, selectedId, selection, onSelect, onUpdate, snap, prefs };

	// One-time scene / renderer / controls setup.
	useEffect(() => {
		const mount = mountRef.current;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x0e0f13);
		scene.fog = new THREE.Fog(0x0e0f13, 600, 2000);

		const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 5000);
		camera.position.set(140, 110, 160);

		let renderer;
		try {
			renderer = new THREE.WebGLRenderer({ antialias: true });
		} catch {
			setViewportError('WebGL is unavailable. Enable hardware acceleration and reload.');
			return;
		}
		renderer.domElement.setAttribute('aria-label', '3D model viewport');
		renderer.domElement.style.touchAction = 'none';
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		mount.appendChild(renderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.target.set(0, 0, 0);
		controls.minDistance = 0.1;
		controls.maxDistance = 10000000;
		const viewHelper = new ViewHelper(camera, renderer.domElement);
		viewHelper.setLabelStyle('22px sans-serif', '#101014', 20);
		viewHelper.setLabels('+X', '+Y', '+Z');
		const negativeAxes = viewHelper.children.filter((child) => child.userData.type?.startsWith('neg'));
		const originalNegativeMaterial = negativeAxes[0].material;
		for (const sprite of negativeAxes) {
			const axis = sprite.userData.type.slice(-1);
			const label = document.createElement('canvas');
			label.width = label.height = 64;
			const context = label.getContext('2d');
			context.fillStyle = { X: '#ff4466', Y: '#88ff44', Z: '#4488ff' }[axis];
			context.beginPath();
			context.arc(32, 32, 20, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = '#101014';
			context.font = '22px sans-serif';
			context.textAlign = 'center';
			context.fillText(`-${axis}`, 32, 41);
			const texture = new THREE.CanvasTexture(label);
			texture.colorSpace = THREE.SRGBColorSpace;
			sprite.material = new THREE.SpriteMaterial({ map: texture, toneMapped: false, opacity: 0.65 });
		}
		originalNegativeMaterial.map.dispose();
		originalNegativeMaterial.dispose();
		const axisElement = axisRef.current;
		let axisPointer = null;
		const axisDown = (event) => {
			if (event.button !== 0 || viewHelper.animating) return;
			axisPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
			axisElement.setPointerCapture(event.pointerId);
		};
		const axisUp = (event) => {
			if (axisPointer?.id !== event.pointerId) return;
			if (event.type !== 'pointercancel' && Math.hypot(event.clientX - axisPointer.x, event.clientY - axisPointer.y) < 5) {
				controls.enableDamping = false;
				controls.update();
				controls.enableDamping = true;
				viewHelper.center.copy(controls.target);
				if (viewHelper.handleClick(event)) {
					controls.enabled = false;
					transform.enabled = false;
					axisElement.setAttribute('aria-busy', 'true');
				}
			}
			axisPointer = null;
			if (axisElement.hasPointerCapture(event.pointerId)) axisElement.releasePointerCapture(event.pointerId);
		};
		axisElement.addEventListener('pointerdown', axisDown);
		axisElement.addEventListener('pointerup', axisUp);
		axisElement.addEventListener('pointercancel', axisUp);

		// Lighting: key directional + soft fill + ambient.
		const key = new THREE.DirectionalLight(0xffffff, 2.2);
		key.position.set(120, 220, 120);
		const fill = new THREE.DirectionalLight(0x88aaff, 0.6);
		fill.position.set(-140, 80, -80);
		const ambient = new THREE.AmbientLight(0xffffff, 0.45);
		scene.add(key, fill, ambient);

		// Grid (large, fades with fog) — sits just below the model floor.
		const grid = new THREE.GridHelper(1000, 100, 0x3b4252, 0x232833);
		grid.position.y = -20;
		grid.material.transparent = true;
		grid.material.opacity = 0.6;
		scene.add(grid);

		// Container group that holds the current model.
		const container = new THREE.Group();
		container.name = 'ModelContainer';
		scene.add(container);
		modelContainerRef.current = container;
		const proxies = new THREE.Group();
		scene.add(proxies);
		const transform = new TransformControls(camera, renderer.domElement);
		transform.setSpace('world');
		transform.setSize(0.85);
		scene.add(transform.getHelper());
		const outline = new THREE.BoxHelper(new THREE.Object3D(), 0x55ddcc);
		outline.visible = false;
		outline.material.depthTest = false;
		scene.add(outline);
		const secondaryOutlines = new THREE.Group();
		scene.add(secondaryOutlines);
		const raycaster = new THREE.Raycaster();
		let directDrag = null;
		let emptyPress = null;
		let gizmoDragging = false;
		const canvas = renderer.domElement;
		const cast = (event) => {
			const rect = canvas.getBoundingClientRect();
			raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
		};
		const commit = (root) => {
			if (!root) return;
			latest.current.onUpdate(root.userData.id, { pos: { x: root.position.x, y: root.position.y, z: root.position.z }, rot: rotFromQuaternion(root.quaternion), face: 'auto' });
		};
		const select = (id) => {
			const root = proxies.children.find((child) => child.userData.id === id);
			transform.detach();
			outline.visible = !!root;
			if (root) {
				transform.attach(root);
				outline.setFromObject(root);
			}
			disposeGroup(secondaryOutlines);
			secondaryOutlines.clear();
			for (const other of latest.current.selection) {
				const proxy = other !== id && proxies.children.find((child) => child.userData.id === other);
				if (!proxy) continue;
				const helper = new THREE.BoxHelper(proxy, 0x7c8cff);
				helper.material.depthTest = false;
				secondaryOutlines.add(helper);
			}
		};
		transform.addEventListener('dragging-changed', (event) => {
			gizmoDragging = event.value;
			controls.enabled = !event.value;
			if (transform.object) transform.object.children[0].material.opacity = event.value ? 0.45 : 0;
		});
		transform.addEventListener('mouseUp', () => commit(transform.object));
		const pointerDown = (event) => {
			if (event.button !== 0 || transform.axis || viewHelper.animating) return;
			cast(event);
			const hit = raycaster.intersectObjects(proxies.children, true)[0];
			if (!hit) {
				emptyPress = { pointer: event.pointerId, x: event.clientX, y: event.clientY, additive: event.shiftKey || event.ctrlKey || event.metaKey };
				return;
			}
			const root = hit.object.parent;
			if (event.shiftKey || event.ctrlKey || event.metaKey) {
				latest.current.onSelect(root.userData.id, true);
				event.stopImmediatePropagation();
				return;
			}
			latest.current.onSelect(root.userData.id);
			select(root.userData.id);
			if (transform.mode !== 'translate') return;
			const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
			const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, root.position);
			const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
			if (!start) return;
			directDrag = { root, plane, start, position: root.position.clone(), rotation: rotFromQuaternion(root.quaternion), moved: false, pointer: event.pointerId, x: event.clientX, y: event.clientY };
			controls.enabled = false;
			canvas.setPointerCapture(event.pointerId);
			event.stopImmediatePropagation();
		};
		const pointerMove = (event) => {
			if (!directDrag || event.pointerId !== directDrag.pointer) return;
			if (Math.hypot(event.clientX - directDrag.x, event.clientY - directDrag.y) < 3 && !directDrag.moved) return;
			directDrag.moved = true;
			cast(event);
			const root = directDrag.root;
			const surface = threeRef.current.surfaces[root.userData.body];
			const hit = latest.current.snap && surface ? raycaster.intersectObject(surface)[0] : null;
			const { gridSnap, gridStep } = latest.current.prefs;
			const step = gridSnap ? gridStep : 0;
			if (hit) {
				const placement = surfacePlacement(snapToGrid(hit.point.clone(), hit.face.normal, step), hit.face.normal, directDrag.rotation);
				root.position.set(placement.pos.x, placement.pos.y, placement.pos.z);
				root.quaternion.copy(quaternionFromRot(placement.rot));
			} else {
				const point = raycaster.ray.intersectPlane(directDrag.plane, new THREE.Vector3());
				if (point) snapToGrid(root.position.copy(directDrag.position).add(point.sub(directDrag.start)), directDrag.plane.normal, step);
			}
			root.children[0].material.opacity = 0.45;
			root.updateMatrixWorld(true);
		};
		const pointerUp = (event) => {
			if (emptyPress?.pointer === event.pointerId) {
				// A click on empty space (not an orbit drag) clears the selection.
				if (event.type === 'pointerup' && !emptyPress.additive && Math.hypot(event.clientX - emptyPress.x, event.clientY - emptyPress.y) < 5) latest.current.onSelect(null);
				emptyPress = null;
			}
			if (!directDrag) return;
			if (event.type === 'pointercancel') {
				directDrag.root.position.copy(directDrag.position);
				directDrag.root.quaternion.copy(quaternionFromRot(directDrag.rotation));
			} else if (directDrag.moved) commit(directDrag.root);
			directDrag.root.children[0].material.opacity = 0;
			directDrag = null;
			controls.enabled = true;
			if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
		};
		const fit = () => {
			if (viewHelper.animating) return;
			const bounds = new THREE.Box3().setFromObject(container);
			if (bounds.isEmpty()) return;
			const sphere = bounds.getBoundingSphere(new THREE.Sphere());
			const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
			const distance = Math.max(1, sphere.radius / Math.sin(angle) * 1.15);
			const direction = camera.position.clone().sub(controls.target).normalize();
			controls.target.copy(sphere.center);
			camera.position.copy(sphere.center).addScaledVector(direction, distance);
			camera.near = Math.max(0.001, distance / 10000);
			camera.far = Math.max(5000, distance * 20);
			camera.updateProjectionMatrix();
		};
		const keyDown = (event) => {
			if (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.key.toLowerCase() === 'w') setMode('translate');
			if (event.key.toLowerCase() === 'e') setMode('rotate');
			if (event.key.toLowerCase() === 'f') fit();
		};
		canvas.addEventListener('pointerdown', pointerDown, true);
		canvas.addEventListener('pointermove', pointerMove);
		canvas.addEventListener('pointerup', pointerUp);
		canvas.addEventListener('pointercancel', pointerUp);
		window.addEventListener('keydown', keyDown);

		let raf = 0;
		let previousTime = performance.now();
		const viewDirection = new THREE.Vector3();
		const animate = (time = performance.now()) => {
			raf = requestAnimationFrame(animate);
			const delta = Math.min((time - previousTime) / 1000, 0.1);
			previousTime = time;
			if (viewHelper.animating) {
				viewHelper.update(delta);
				if (!viewHelper.animating) {
					controls.enabled = true;
					transform.enabled = true;
					axisElement.setAttribute('aria-busy', 'false');
				}
			} else controls.update();
			viewDirection.copy(camera.position).sub(controls.target).normalize();
			const alignedAxis = ['x', 'y', 'z'].find((axis) => Math.abs(viewDirection[axis]) > 1 - 1e-8);
			const viewDescription = alignedAxis ? `View from ${viewDirection[alignedAxis] > 0 ? '+' : '-'}${alignedAxis.toUpperCase()}` : 'Orbit view';
			if (axisElement.getAttribute('aria-description') !== viewDescription) axisElement.setAttribute('aria-description', viewDescription);
			if (outline.visible && transform.object) outline.setFromObject(transform.object);
			renderer.render(scene, camera);
			renderer.autoClear = false;
			viewHelper.render(renderer);
			renderer.autoClear = true;
		};
		animate();

		const resize = () => {
			const w = mount.clientWidth;
			const h = mount.clientHeight;
			camera.aspect = Math.max(1, w) / Math.max(1, h);
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		};
		const ro = new ResizeObserver(resize);
		ro.observe(mount);

		threeRef.current = { scene, renderer, controls, container, camera, proxies, transform, select, fit, grid, surfaces: {}, fitted: false, isDragging: () => gizmoDragging || !!directDrag };

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			viewHelper.dispose();
			axisElement.removeEventListener('pointerdown', axisDown);
			axisElement.removeEventListener('pointerup', axisUp);
			axisElement.removeEventListener('pointercancel', axisUp);
			transform.dispose();
			outline.geometry.dispose();
			outline.material.dispose();
			disposeGroup(secondaryOutlines);
			disposeGroup(proxies);
			for (const surface of Object.values(threeRef.current?.surfaces || {})) {
				surface.geometry.dispose();
				surface.material.dispose();
			}
			canvas.removeEventListener('pointerdown', pointerDown, true);
			canvas.removeEventListener('pointermove', pointerMove);
			canvas.removeEventListener('pointerup', pointerUp);
			canvas.removeEventListener('pointercancel', pointerUp);
			window.removeEventListener('keydown', keyDown);
			grid.geometry.dispose();
			grid.material.dispose();
			disposeGroup(container);
			renderer.dispose();
			if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
			threeRef.current = null;
		};
	}, []);

	// Swap the model into the container when it changes.
	useEffect(() => {
		const container = modelContainerRef.current;
		if (!container) return;
		// Remove previous model (dispose its geometries/materials).
		disposeGroup(container);
		container.clear();
		if (model) {
			container.add(model);
			container.updateMatrixWorld(true);
			onModelRef?.(model);
			if (threeRef.current && !threeRef.current.fitted) {
				threeRef.current.fit();
				threeRef.current.fitted = true;
			}
		} else {
			onModelRef?.(null);
		}
	}, [model, onModelRef]);

	useEffect(() => {
		if (!model) return;
		const translucent = transparentBase;
		for (const name of ['Base_Mesh', 'Lid_Mesh']) {
			const body = model.getObjectByName(name);
			if (!body) continue;
			body.material.transparent = translucent;
			body.material.opacity = translucent ? 0.6 : 1;
			body.material.depthWrite = !translucent;
			body.material.needsUpdate = true;
		}
	}, [model, transparentBase]);

	useEffect(() => {
		const lid = model?.getObjectByName('Lid');
		if (!lid) return;
		if (showLayout && lid.userData.printMatrix) lid.userData.printMatrix.decompose(lid.position, lid.quaternion, lid.scale);
		else {
			lid.position.set(0, 0, 0);
			lid.quaternion.identity();
			lid.scale.set(1, 1, 1);
		}
		lid.updateMatrixWorld(true);
	}, [model, showLayout]);

	useEffect(() => {
		const state = threeRef.current;
		if (!state || !fonts) return;
		state.transform.detach();
		disposeGroup(state.proxies);
		state.proxies.clear();
		for (const surface of Object.values(state.surfaces)) {
			surface.geometry.dispose();
			surface.material.dispose();
		}
		state.surfaces = {};
		try {
			state.surfaces.base = new THREE.Mesh(createBodyGeometry(settings, 'base'), new THREE.MeshBasicMaterial());
			if (lidEnabled(settings) && !showLayout) state.surfaces.lid = new THREE.Mesh(createBodyGeometry(settings, 'lid'), new THREE.MeshBasicMaterial());
		} catch { /* build errors are reported by the model pipeline */ }
		state.grid.position.y = -settings.height / 2 - 0.2;
		for (const object of settings.objects) {
			const body = objectBody(object, settings);
			if (!body || (body === 'lid' && showLayout)) continue;
			let geometry;
			try {
				geometry = createObjectGeometry(object, fonts, settings, { holeLength: 1 });
			} catch { continue; }
			if (!geometry) continue;
			const root = new THREE.Group();
			root.userData.id = object.id;
			root.userData.body = body;
			root.position.set(object.pos.x, object.pos.y, object.pos.z);
			root.quaternion.copy(quaternionFromRot(object.rot));
			const brush = placeObject(geometry, object, settings);
			const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x55ddcc, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
			mesh.position.copy(brush.position).sub(root.position).applyQuaternion(root.quaternion.clone().invert());
			mesh.scale.copy(brush.scale);
			root.add(mesh);
			root.updateMatrix();
			const toRoot = root.matrix.clone().invert();
			for (const placement of arrayInstances(object).slice(1)) {
				const copy = new THREE.Mesh(geometry, mesh.material);
				toRoot.clone().multiply(placeObject(geometry, { ...object, ...placement }, settings).matrixWorld).decompose(copy.position, copy.quaternion, copy.scale);
				root.add(copy);
			}
			state.proxies.add(root);
		}
		state.proxies.updateMatrixWorld(true);
		state.select(latest.current.selectedId);
	}, [settings, fonts, showLayout]);

	useEffect(() => { threeRef.current?.select(selectedId); }, [selection, selectedId]);
	useEffect(() => { threeRef.current?.transform.setMode(mode); }, [mode]);
	useEffect(() => {
		const transform = threeRef.current?.transform;
		if (!transform) return;
		transform.setTranslationSnap(prefs.gridSnap ? prefs.gridStep : null);
		transform.setRotationSnap(prefs.gridSnap ? THREE.MathUtils.degToRad(prefs.angleStep) : null);
	}, [prefs.gridSnap, prefs.gridStep, prefs.angleStep]);

	return (
		<div className="relative min-h-[240px] min-w-0 flex-1" data-testid="viewport" aria-busy={status.building || !!status.activity || status.initializing}>
			<div ref={mountRef} className="absolute inset-0" />
			<BuildStatus {...status} />
			<div ref={axisRef} role="group" aria-label="Align view with axis" aria-busy="false" title="Align view with axis" className="absolute bottom-0 right-0 h-32 w-32 cursor-pointer touch-none" />
			<div className="absolute left-3 top-3 flex gap-1 rounded border border-white/10 bg-neutral-900/95 p-1" role="toolbar" aria-label="Viewport tools">
				{[{ id: 'translate', Icon: Move3D, label: 'Move (W)' }, { id: 'rotate', Icon: Rotate3D, label: 'Rotate (E)' }].map(({ id, Icon, label }) => (
					<button key={id} title={label} aria-label={label} aria-pressed={mode === id} onClick={() => setMode(id)} className={`h-9 w-9 grid place-items-center rounded ${mode === id ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><Icon size={18} /></button>
				))}
				<button title="Snap to surface" aria-label="Snap to surface" aria-pressed={snap} onClick={() => setSnap(!snap)} className={`h-9 w-9 grid place-items-center rounded ${snap ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><Magnet size={18} /></button>
				<button title={`Grid snap (${prefs.gridStep} mm, ${prefs.angleStep}°)`} aria-label="Grid snap" aria-pressed={prefs.gridSnap} onClick={onToggleGridSnap} className={`h-9 w-9 grid place-items-center rounded ${prefs.gridSnap ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><Grid3x3 size={18} /></button>
				<button title="Fit model (F)" aria-label="Fit model (F)" onClick={() => threeRef.current?.fit()} className="h-9 w-9 grid place-items-center rounded text-neutral-300 hover:bg-neutral-700"><Maximize size={18} /></button>
				<button title="Transparent base preview" aria-label="Transparent base preview" aria-pressed={transparentBase} onClick={() => setTransparentBase(!transparentBase)} className={`h-9 w-9 grid place-items-center rounded ${transparentBase ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><Blend size={18} /></button>
				{hasLid && <button title="Lay out for print" aria-label="Lay out for print" aria-pressed={showLayout} onClick={() => setPrintLayout(!printLayout)} className={`h-9 w-9 grid place-items-center rounded ${showLayout ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><PackageOpen size={18} /></button>}
			</div>
			{viewportError && <p role="alert" className="absolute bottom-4 left-4 right-4 bg-red-950 p-3 text-sm">{viewportError}</p>}
		</div>
	);
}
