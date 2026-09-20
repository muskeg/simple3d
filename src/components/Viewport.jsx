import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Move3D, Rotate3D, Magnet, Maximize } from 'lucide-react';
import { disposeGroup } from '../lib/csg.js';
import { placeObject } from '../lib/csg.js';
import { createBaseGeometry } from '../lib/baseShapes.js';
import { createTextGeometry } from '../lib/geometry.js';
import { getMaskGeometry } from '../lib/mask.js';
import { objectFont } from '../lib/fonts.js';
import { quaternionFromRot, rotFromQuaternion, surfacePlacement } from '../lib/placement.js';

export default function Viewport({ model, onModelRef, settings, fonts, selectedId, onSelect, onUpdate }) {
	const mountRef = useRef(null);
	const threeRef = useRef(null);
	const modelContainerRef = useRef(null);
	const latest = useRef(null);
	const [mode, setMode] = useState('translate');
	const [snap, setSnap] = useState(true);
	const [viewportError, setViewportError] = useState(null);
	latest.current = { settings, fonts, selectedId, onSelect, onUpdate, snap };

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
		const raycaster = new THREE.Raycaster();
		let directDrag = null;
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
		};
		transform.addEventListener('dragging-changed', (event) => {
			gizmoDragging = event.value;
			controls.enabled = !event.value;
			if (transform.object) transform.object.children[0].material.opacity = event.value ? 0.45 : 0;
		});
		transform.addEventListener('mouseUp', () => commit(transform.object));
		const pointerDown = (event) => {
			if (event.button !== 0 || transform.axis) return;
			cast(event);
			const hit = raycaster.intersectObjects(proxies.children, true)[0];
			if (!hit) return;
			const root = hit.object.parent;
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
			const surface = threeRef.current.surface;
			const hit = latest.current.snap && surface ? raycaster.intersectObject(surface)[0] : null;
			if (hit) {
				const placement = surfacePlacement(hit.point, hit.face.normal, directDrag.rotation);
				root.position.set(placement.pos.x, placement.pos.y, placement.pos.z);
				root.quaternion.copy(quaternionFromRot(placement.rot));
			} else {
				const point = raycaster.ray.intersectPlane(directDrag.plane, new THREE.Vector3());
				if (point) root.position.copy(directDrag.position).add(point.sub(directDrag.start));
			}
			root.children[0].material.opacity = 0.45;
			root.updateMatrixWorld(true);
		};
		const pointerUp = (event) => {
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
		const animate = () => {
			raf = requestAnimationFrame(animate);
			controls.update();
			if (outline.visible && transform.object) outline.setFromObject(transform.object);
			renderer.render(scene, camera);
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

		threeRef.current = { scene, renderer, controls, container, camera, proxies, transform, select, fit, grid, surface: null, fitted: false, isDragging: () => gizmoDragging || !!directDrag };

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			transform.dispose();
			outline.geometry.dispose();
			outline.material.dispose();
			disposeGroup(proxies);
			threeRef.current?.surface?.geometry.dispose();
			threeRef.current?.surface?.material.dispose();
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
		const state = threeRef.current;
		if (!state || !fonts) return;
		state.transform.detach();
		disposeGroup(state.proxies);
		state.proxies.clear();
		state.surface?.geometry.dispose();
		state.surface?.material.dispose();
		state.surface = new THREE.Mesh(createBaseGeometry(settings), new THREE.MeshBasicMaterial());
		state.grid.position.y = -settings.height / 2 - 0.2;
		for (const object of settings.objects) {
			let geometry;
			try {
				geometry = object.type === 'image' ? getMaskGeometry(object)?.clone() : createTextGeometry(object.text, objectFont(fonts, object, settings), object);
			} catch { continue; }
			if (!geometry) continue;
			const root = new THREE.Group();
			root.userData.id = object.id;
			root.position.set(object.pos.x, object.pos.y, object.pos.z);
			root.quaternion.copy(quaternionFromRot(object.rot));
			const brush = placeObject(geometry, object, settings, settings.mode);
			const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x55ddcc, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
			mesh.position.copy(brush.position).sub(root.position).applyQuaternion(root.quaternion.clone().invert());
			mesh.scale.copy(brush.scale);
			root.add(mesh);
			state.proxies.add(root);
		}
		state.proxies.updateMatrixWorld(true);
		state.select(latest.current.selectedId);
	}, [settings, fonts]);

	useEffect(() => { threeRef.current?.select(selectedId); }, [selectedId]);
	useEffect(() => { threeRef.current?.transform.setMode(mode); }, [mode]);

	return (
		<div className="relative min-h-[240px] min-w-0 flex-1" data-testid="viewport">
			<div ref={mountRef} className="absolute inset-0" />
			<div className="absolute left-3 top-3 flex gap-1 rounded border border-white/10 bg-neutral-900/95 p-1" role="toolbar" aria-label="Viewport tools">
				{[{ id: 'translate', Icon: Move3D, label: 'Move (W)' }, { id: 'rotate', Icon: Rotate3D, label: 'Rotate (E)' }].map(({ id, Icon, label }) => (
					<button key={id} title={label} aria-label={label} aria-pressed={mode === id} onClick={() => setMode(id)} className={`h-9 w-9 grid place-items-center rounded ${mode === id ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><Icon size={18} /></button>
				))}
				<button title="Snap to surface" aria-label="Snap to surface" aria-pressed={snap} onClick={() => setSnap(!snap)} className={`h-9 w-9 grid place-items-center rounded ${snap ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}><Magnet size={18} /></button>
				<button title="Fit model (F)" aria-label="Fit model (F)" onClick={() => threeRef.current?.fit()} className="h-9 w-9 grid place-items-center rounded text-neutral-300 hover:bg-neutral-700"><Maximize size={18} /></button>
			</div>
			{viewportError && <p role="alert" className="absolute bottom-4 left-4 right-4 bg-red-950 p-3 text-sm">{viewportError}</p>}
		</div>
	);
}
