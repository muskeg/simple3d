import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import JSZip from 'jszip';

/**
 * Compact, spec-compliant 3D Manufacturing Format (.3mf) exporter.
 *
 * A .3mf is a ZIP package containing:
 *   [Content_Types].xml   - OPC content types
 *   _rels/.rels           - package relationships -> 3D/3dmodel.model
 *   3D/3dmodel.model      - the model XML (resources + build)
 *
 * Named mesh resources share one assembly, preserving part alignment.
 * Core base materials distinguish the base and inlays. Vertices are
 * indexed and transformed from the editor's Y-up frame to Z-up millimeters.
 */
export class ThreeMFExporter {
	static serialize(scene, { binary = false } = {}) {
		return ThreeMFExporter.serializeObject(scene, { binary });
	}

	static serializeObject(object, { binary = false } = {}) {
		object.updateMatrixWorld(true);
		const meshes = [];
		object.traverse((o) => {
			if (o.isMesh && o.geometry?.attributes.position?.count) meshes.push(o);
		});
		if (meshes.length === 0) throw new Error('3MFExporter: no meshes found to export');

		const objectsXml = meshes
			.map((mesh, i) => ThreeMFExporter.buildObjectXML(mesh, i + 1))
			.join('\n        ');
		const materials = '<basematerials id="1"><base name="Base" displaycolor="#8A93A6FF"/><base name="Inlay" displaycolor="#E8A33DFF"/></basematerials>';
		// One aligned assembly (and build item) per printable body: base, then lid.
		const bodies = [...new Set(meshes.map((mesh) => mesh.userData.body || 'base'))];
		const assemblies = bodies.map((body, index) => {
			const id = meshes.length + 2 + index;
			const components = meshes.map((mesh, meshIndex) => ((mesh.userData.body || 'base') === body ? `<component objectid="${meshIndex + 2}"/>` : '')).join('');
			return { id, xml: `<object id="${id}" type="model" name="${body === 'lid' ? 'Simple3D_Lid' : 'Simple3D'}"><components>${components}</components></object>` };
		});
		const assembly = assemblies.map((entry) => entry.xml).join('');
		const buildXml = assemblies.map((entry) => `<item objectid="${entry.id}"/>`).join('');

		const modelXml =
			`<?xml version="1.0" encoding="UTF-8"?>\n` +
			`<model unit="millimeter" xml:lang="en-US" ` +
		`xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
			`  <resources>\n        ${materials}${objectsXml}${assembly}\n  </resources>\n` +
		`  <build>${buildXml}\n  </build>\n` +
		`</model>\n`;

		if (binary) {
			const doc = new DOMParser().parseFromString(modelXml, 'text/xml');
			const body = doc.querySelector('model');
			// Serialize via XMLSerializer for the binary (compressed) variant.
			const serialized = new XMLSerializer().serializeToString(body);
			return serialized;
		}
		return modelXml;
	}

	/** Build a single <object> with its mesh (vertices + triangles) in mm. */
	static buildObjectXML(mesh, id) {
		const geometry = mesh.geometry;
		const pos = geometry.getAttribute('position');

		// Apply the object's world transform so placement is preserved,
		// then convert to millimeters (3MF canonical unit).
		const world = new THREE.Matrix4().copy(mesh.matrixWorld);
		const v = new THREE.Vector3();
		const verts = [];
		const vertexIds = [];
		const unique = new Map();
		for (let i = 0; i < pos.count; i++) {
			v.fromBufferAttribute(pos, i).applyMatrix4(world);
			if (![v.x, v.y, v.z].every(Number.isFinite)) throw new Error('Non-finite mesh vertex');
			const coordinates = [v.x, -v.z, v.y].map((value) => value.toFixed(6));
			const key = coordinates.join(',');
			if (!unique.has(key)) {
				unique.set(key, verts.length);
				verts.push(`<vertex x="${coordinates[0]}" y="${coordinates[1]}" z="${coordinates[2]}"/>`);
			}
			vertexIds.push(unique.get(key));
		}
		const verticesXml = verts.join('');

		const idx = geometry.getIndex();
		const triCount = idx ? idx.count / 3 : pos.count / 3;
		const tris = [];
		for (let i = 0; i < triCount; i++) {
			const a = vertexIds[idx ? idx.getX(i * 3) : i * 3];
			const b = vertexIds[idx ? idx.getX(i * 3 + 1) : i * 3 + 1];
			const c = vertexIds[idx ? idx.getX(i * 3 + 2) : i * 3 + 2];
			if (a === b || b === c || c === a) continue;
			tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
		}

		const name = mesh.name || 'Object';
		return (
			`<object id="${id + 1}" type="model" name="${escapeXml(name)}" pid="1" pindex="${name.startsWith('Inlay_') ? 1 : 0}">\n` +
			`          <mesh>\n            <vertices>${verticesXml}</vertices>\n` +
			`            <triangles>${tris.join('')}</triangles>\n          </mesh>\n        </object>`
		);
	}

	/** Returns a non-indexed geometry (triangles explicit) for safe 3MF output. */
	static toIndexedNonIndexed(geometry) {
		if (geometry.index) {
			return geometry.toNonIndexed();
		}
		return geometry;
	}
}

function escapeXml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

const CONTENT_TYPES =
	`<?xml version="1.0" encoding="UTF-8"?>\n` +
	`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
	`  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
	`  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
	`</Types>\n`;

const PACKAGE_RELS =
	`<?xml version="1.0" encoding="UTF-8"?>\n` +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
	`  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n` +
	`</Relationships>\n`;

/** Packs the model into a .3mf (ZIP) Blob. */
export async function export3MF(group) {
	const modelXml = ThreeMFExporter.serializeObject(group);
	const zip = new JSZip();
	zip.file('[Content_Types].xml', CONTENT_TYPES);
	zip.file('_rels/.rels', PACKAGE_RELS);
	zip.file('3D/3dmodel.model', modelXml);
	return zip.generateAsync({
		type: 'blob',
		mimeType: 'model/3mf',
		compression: 'DEFLATE',
		compressionOptions: { level: 6 },
	});
}

/** STL fallback (binary). */
export function exportSTL(group) {
	const exporter = new STLExporter();
	const scene = new THREE.Group();
	scene.rotation.x = Math.PI / 2;
	scene.add(group.clone(true));
	scene.updateMatrixWorld(true);
	return exporter.parse(scene, { binary: true });
}

/** Triggers a browser download for a Blob. */
export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
