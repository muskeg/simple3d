# Simple3D

A browser-based solid-model editor for dimensioned bases, text and image masks.
Build raised lettering, engraved cuts, or separate flush-inlay parts, then export
STL or multi-part 3MF. Geometry and image processing happen locally in the browser.

## Run Locally

Use Node.js 20 or newer (Node.js 22 is used in CI), npm, and a WebGL-capable browser.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite with `/simple3d/` at the end, normally
`http://localhost:5173/simple3d/`. WSL file polling is enabled so changes under
Windows-mounted directories are detected reliably.

```sh
npm run build
npm run preview
```

The production application is in `dist/`. Serve it over HTTP; opening the HTML
directly is insufficient for the font and WebAssembly assets.

## Editing

### Base Dimensions

- Box, cylinder, sphere, cone and pyramid are supported.
- Width, Depth and Height are the **complete base bounding box in millimeters**,
	including chamfers/fillets. A non-square cylinder or cone has an elliptical
	footprint; a non-square pyramid has a rectangular footprint. A sphere can be
	an ellipsoid. Tessellation is normalized to preserve the requested extents.
- Box corners can be rounded. Box and cylinder edges can be chamfered or filleted.
- Corner radius is limited to half the smaller footprint dimension. Chamfer is
	limited to 45% of the smallest dimension, preserving a positive core. The
	displayed controls reflect these limits.
- Sliders provide convenient ranges, not hard dimensional limits. Type a value
	and press Enter or leave the field to apply it. Escape cancels an edit.
- Base dimensions start at 0.1 mm. Typed dimensions are capped at 1,000,000 mm;
	positions and angles allow negative values. Inputs retain up to three decimal
	places and reject malformed or non-finite values. Geometry uses floating-point
	arithmetic, not exact rational arithmetic.
- Surface/curve segment counts and mask resolution have hard complexity limits.

### Objects And Fonts

Add as many text/image objects as the browser can reasonably handle. Select one
in the list or by clicking its geometry. Duplicate and delete act on individual
objects; deleting the last object leaves a valid base-only model. Empty text
adds no geometry.

Each text object has its own font, size and extrusion height. The four bundled
faces are Helvetiker, Helvetiker Bold, Optimer and Gentilis. Glyph coverage is
limited to the bundled typeface data; Three.js substitutes its fallback glyph
for unsupported characters. Font size is a typeface size, not the exact text
bounding-box width.

### Placement And Rotation

- Drag an object directly to move it. With the magnet enabled, the anchor snaps
	to the raycast base surface and the extrusion axis aligns to its normal.
- With the magnet disabled, direct dragging stays in the object's face plane.
- The Move gizmo allows unconstrained world-axis/plane translation. The Rotate
	gizmo provides full 3D rotation. Gizmos do not apply the direct-drag magnet.
- `W` selects Move, `E` selects Rotate, and `F` fits the complete model. These
	shortcuts do not intercept typing in inputs. Toolbar buttons expose the same
	actions on touch screens.
- Drag empty viewport space to orbit; use the wheel/pinch gesture to zoom.
	Orbiting below the model is supported.
- Position is the surface anchor in editor coordinates: X across, Y up, Z front.
	Numeric rotations are Euler XYZ degrees; composed rotations and gizmo edits
	are calculated with quaternions.
- Axis-angle controls apply an additional world rotation. Choose X/Y/Z or a
	custom numeric vector; custom vectors are normalized and zero axes rejected.
- The six face buttons raycast the actual mesh, including sloped pyramid/cone
	surfaces. Named-face attachments follow base resizing. Manual positioning,
	free rotation and drag placement use world coordinates instead.

Objects remain rigid planar extrusions: snapping to an ellipsoid or cone does
not bend text around it. A large object on a curved surface may make only partial
contact. Inspect placement and connectivity before printing. Free placement can
intentionally produce disconnected solids.

### Image Masks

Upload PNG, JPEG, WebP or GIF (up to 20 MB), or replace an existing object's image.
No upload is sent to a server. A mask is rasterized once per parameter change.

- **Alpha** selects sufficiently opaque pixels, useful for transparent PNG logos.
- **Dark pixels** selects dark regions weighted by alpha, useful for black-on-white artwork.
- **Light pixels** selects light regions weighted by alpha.
- Threshold is 1-255. Fully transparent pixels never contribute geometry.
- Mask Width is the width of the **entire image canvas**, including transparent
	margins; height follows its aspect ratio. The image center stays at the anchor.
- Resolution is the maximum raster dimension (64-1024); increasing it preserves
	more detail but costs processing time. Images are not upsampled.
- Contours preserve holes and disconnected islands. Masks share the same
	placement, rotation, extrusion and operation controls as text.

### Operations And Export

The operation mode applies to all objects:

| Mode | Result |
| --- | --- |
| Raised | Union of the base and outward extrusions. Outward height is exact; 0.05 mm of inward overlap makes the surface connection robust. |
| Inset | Cut inward by Inset Depth, independently of the object's raised extrusion height. A sufficiently deep cut can pierce the base. |
| Flush Inlay | Full-thickness cut along each object's extrusion axis, plus a separate matching inlay part. Earlier objects own overlapping inlay volume. |

**3MF is recommended.** It contains a single aligned assembly, named base/inlay
components, shared vertex indices, and core base-material colors. Slicers may
require explicit material/extruder assignment. This is not a slicer-specific
project file and does not contain printer settings.

STL is a binary fallback without part colors. Both formats use millimeters and
convert the editor's Y-up coordinates to conventional Z-up print coordinates.
The base is origin-centered; arrange the assembly on the build plate in the slicer.

Export is disabled until the current settings are successfully built. Invalid
geometry or a completely removed model cannot silently export a previous result.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run test:production
```

On a Linux system missing browser libraries, use Playwright's documented system
dependency installation. CI installs them with `playwright install --with-deps`.
The production-test script uses POSIX environment syntax (Linux, macOS or WSL).

The numerical suite covers dimensions, placement, closed topology, inlay volume,
mask contours and export packaging. Browser tests exercise actual controls,
pointer gestures, uploads, downloads and nonblank rendering at 1440px and 390px.
Screenshots/traces are written to ignored `test-results/`.

See [docs/REVIEW.md](docs/REVIEW.md) for the requirement audit, architecture,
verification results and remaining validation boundaries.

## GitHub Pages

The workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs
unit tests, builds the app and tests the production artifact in Chromium before
deploying. Pull requests run the same checks without deploying.

1. In the GitHub repository, set **Settings > Pages > Source > GitHub Actions**.
2. Push the tested changes to `main`, or run the workflow manually from `main`.
3. After the workflow succeeds, open `https://muskeg.github.io/simple3d/`.

`vite.config.js` uses `/simple3d/` as the asset base. Change it if the repository
name or hosting path changes. Enabling Pages and actually running the remote
workflow are separate from a successful local production test.

## Stack And Limits

React 19, Vite 6, Tailwind CSS 4, Three.js, Manifold WASM, d3-contour and JSZip.
Manifold performs solid booleans; Three.js provides rendering, text extrusion and
transform/orbit controls. Bundled fonts retain their upstream license in
[public/fonts/LICENSE](public/fonts/LICENSE) and embedded typeface metadata.

There is no server, autosave, undo history or project-file persistence. Reloading
resets the editor. Large masks, high tessellation and many objects can block the
main thread during rebuilding. WebGL and WebAssembly are required. Physical
printing, printer tolerances and third-party slicer compatibility must still be
checked for the intended printer and materials.
