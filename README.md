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

The left panel has **Base** (shape, dimensions, shell and lid) and **Objects**
(default mode, add buttons and the object list) tabs; the **File** menu holds
New, Open, Save and the presets. The right-hand **Inspector** edits the selected
object. On narrow screens the Inspector becomes an **Edit** tab that opens when
you select an object. Sections collapse and remember their state; rarely used
settings live under **Advanced**, and numeric position/rotation under
**Transform**.

Keyboard: `Ctrl/Cmd+Z` undoes and `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`) redoes,
`Delete`/`Backspace` deletes the selection, `Ctrl/Cmd+D` duplicates
it, arrow keys nudge it along the primary object's reading axes (1 mm; `Shift`
10 mm; `Alt` 0.1 mm) and `Escape` clears the selection. Shortcuts are ignored
while typing in a field, where the browser's own text undo applies.

**Undo/redo** (also in the panel header) keeps the last 100 steps. A burst of
edits to the same fields, such as typing, scrubbing a label or dragging an
object, becomes one step; applying a preset, opening a project or starting a
new one can be undone too. The design is **autosaved** in the browser about a
second after each change and restored on the next visit. Very large designs
(big images or fonts) can exceed browser storage; autosave then pauses with a
notice, and File > Save project still works.

### Base Dimensions

- Box, cylinder, sphere, cone, pyramid, N-gon prism (3-12 sides, flat front
	edge), tube (with wall thickness) and torus are supported.
- Width, Depth and Height are the **complete base bounding box in millimeters**,
	including chamfers/fillets. A non-square cylinder or cone has an elliptical
	footprint; a non-square pyramid has a rectangular footprint. A sphere can be
	an ellipsoid. Tessellation is normalized to preserve the requested extents.
- Box corners can be rounded. Box, cylinder and N-gon edges can be chamfered or filleted.
- Corner radius is limited to half the smaller footprint dimension. Chamfer is
	limited to 45% of the smallest dimension, preserving a positive core. The
	displayed controls reflect these limits.
- Drag a field's label left/right to scrub its value (`Shift` x10, `Alt` x0.1),
	or type a value and press Enter or leave the field to apply it. Arrow Up/Down
	in a field steps it. Escape cancels an edit.
- Base dimensions start at 0.1 mm. Typed dimensions are capped at 1,000,000 mm;
	positions and angles allow negative values. Inputs retain up to three decimal
	places and reject malformed or non-finite values. Geometry uses floating-point
	arithmetic, not exact rational arithmetic.
- Surface/curve segment counts and mask resolution have hard complexity limits.

### Custom Base Meshes

Choose **Custom** in the base shapes to import an STL (binary or ASCII), OBJ
or 3MF file (up to 25 MB and 500,000 triangles) as the base. STL and 3MF are
treated as Z-up print files and converted to the editor's Y-up; OBJ is taken as
Y-up. 3MF units are converted to millimeters; STL and OBJ are assumed to be in
millimeters. On import, duplicate vertices are merged, an inside-out mesh is
flipped, overlapping parts are unioned into one solid and inward-facing inner
shells become cavities. Meshes with holes, open edges or non-manifold geometry
are rejected with a message; repair them first (for example in your slicer or
Meshmixer). Meshes above 200,000 triangles import with a notice that rebuilds
will be slow.

The mesh imports at its real size. Width, Depth and Height scale it; **Keep
proportions** (on by default) scales the other two dimensions with the one you
edit, **Original size** restores the file's size and **Rotate 90° X/Y/Z** fixes
files exported lying on their side. Face snapping, dragging, holes (including
First wall), arrays and inlays work on the imported surface. Hollow shells, lids,
chamfers and corner radii are not available for custom bases. The mesh is
embedded in project files and autosave; large meshes may exceed browser storage.

### Shell And Lid

Box, cylinder and N-gon bases can be hollowed with a uniform **Wall Thickness**
(the floor uses the same thickness), with the top open or closed. The cavity is
the base footprint offset inward, so walls are exact for boxes and N-gons and
measured normal to the outline for ellipses. With the shell on, the chamfer is
limited to half the wall.

An open shell can get a **lid**: a plate matching the footprint plus a locating
lip offset inward by wall + **Lid Clearance** (default 0.2 mm). In the editor the
lid floats above the box; objects can target the lid with the object's **Body**
select. The **Lay out for print** toolbar toggle previews the export layout: the
lid flipped upside down beside the box on the same floor. Exports always use
that layout, so raised details on the lid top face the bed. A non-blocking
warning appears when an inset or inlay is as deep as the wall.

### Objects And Fonts

Add text, image masks, SVG outlines, shapes (circle, rectangle, star, heart,
polygon, arrow) and holes. Select one in the list or by clicking its geometry.
Duplicate and delete act on individual objects; deleting the last object leaves
a valid base-only model. Empty text adds no geometry.

- Every object except holes has its own **Object Mode**: Default (follows the
	global Operation Mode), Raised, Inset or Flush inlay, with its own depths.
- **Mirror** flips an object's reading direction, for stamps.
- **Holes** cut along the object axis (plain, countersunk at 90°, or
	counterbored) and also cut raised objects and inlays. **Hole Depth** is
	**Through all** (the whole body), **First wall** (stops just past the first
	wall it crosses, so a hole in a hollow box pierces only one side; on a solid
	body this is the same as through) or **Fixed depth** (a blind hole of Blind
	Depth mm). First wall probes the shaft's center and rim, so curved walls are
	cleared fully without reaching the next wall.
- **Mesh** objects import an STL, OBJ or 3MF (same validation as custom bases)
	and combine it with the body using the object's mode. **Mesh Width** scales it
	uniformly. Raised meshes sit on the surface; inset and flush-inlay meshes sink
	until their top is flush, so the cut is as deep as the mesh is tall.
- **SVG** files (up to 2 MB) use their filled paths; overlapping paths are
	unioned. SVG Width sets the outline width. SVGs are parsed as XML only and
	never inserted into the page.

Each text object has its own font, size and extrusion height. The four bundled
faces are Helvetiker, Helvetiker Bold, Optimer and Gentilis. Text may span
several lines (Enter in the text box) aligned left, center or right, with
**Letter Spacing** in millimeters (negative values tighten) and **Line Spacing**
as a multiple of the typeface line height. Glyph outlines are merged before
extrusion, so overlapping letters still form one valid solid. Kerning is not
applied.

**Upload font** (next to the font menu) adds a TTF or OTF file (up to 10 MB,
8 per project) to the project; it is embedded in saved project files. Glyph
coverage is limited to the font; missing characters fall back to `?` when the
font has it and are otherwise skipped. Font size is a typeface size, not the
exact text bounding-box width.

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
	Click empty space without dragging to deselect, hiding the gizmo and outlines.
	Orbiting below the model is supported.
- Click an endpoint on the bottom-right axis gizmo to align the view from +X,
	-X, +Y, -Y, +Z or -Z. The transition preserves the current orbit target and
	camera distance. +Y is top, -Y bottom, +Z front, -Z back, +X right and -X left.
	The gizmo tracks the camera as you orbit; it does not rotate model objects.
- Position is the surface anchor in editor coordinates: X across, Y up, Z front.
	Numeric rotations are Euler XYZ degrees; composed rotations and gizmo edits
	are calculated with quaternions.
- Axis-angle controls apply an additional world rotation. Choose X/Y/Z or a
	custom numeric vector; custom vectors are normalized and zero axes rejected.
- The six face buttons raycast the actual mesh, including sloped pyramid/cone
	surfaces. Named-face attachments follow base resizing. Manual positioning,
	free rotation and drag placement use world coordinates instead.
- **Center on face** moves an object within its surface plane to the center of
	the face its normal points to (across, up, or both). **Center on body** sets
	one world coordinate to the body's center.
- **Grid snap** (viewport toolbar) rounds drag positions to the Grid Step and
	gizmo rotations to the Angle Step, both set under Transform.
- **Multi-select** with `Shift`/`Ctrl`/`Cmd`+click in the list or viewport. The
	last object clicked is the primary one shown in the Inspector and carrying
	the gizmo. Moving it moves the whole selection; rotation applies to the
	primary object only. With several objects selected, align their bounding
	boxes to the selection's min, center or max on world X, Y or Z, distribute
	three or more with equal gaps (the outermost objects stay put), or duplicate
	and delete them together.
- **Arrays** repeat an object without extra list entries: **linear** (Count and
	Spacing along its reading direction), **grid** (plus Rows and Row Spacing
	downward) or **circular** (Count copies orbiting a center Array Radius below
	the original, clockwise over the Sweep angle, optionally rotating with the
	circle). Copies are rigid offsets in the object's surface plane, so they can
	lift off curved bases. Up to 400 copies per object. Each flush-inlay copy is
	its own part (`Inlay_<id>`, `Inlay_<id>.1`, ...). **Convert to separate
	objects** turns the copies into ordinary, independently editable objects.

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

The global operation mode applies to every object whose Object Mode is Default:

| Mode | Result |
| --- | --- |
| Raised | Union of the base and outward extrusions. Outward height is exact; 0.05 mm of inward overlap makes the surface connection robust. |
| Inset | Cut inward by Inset Depth (or the object's own depth), independently of the object's raised extrusion height. A sufficiently deep cut can pierce the base. |
| Flush Inlay | A pocket cut inward from each object's surface anchor by its own Inlay Depth, plus a separate matching inlay part flush with the base surface. Earlier objects own overlapping inlay volume. |

Each body is built in a fixed order: insets and inlay pockets (object order),
then raised objects (which take their volume from any inlay they overlap), then
holes. Raised text anchored on a pocket floor therefore survives the pocket.

In **Flush Inlay** mode, select a text or image object and set **Inlay Depth** in
its object controls (default 2 mm, minimum 0.1 mm). This is independent of raised
extrusion height and of other objects' depths. For a die, snap objects to the six
faces and give each a shallow depth to preserve the core. Depth is measured along
the object's inward extrusion axis, including on rotated faces. It is not
automatically capped to local wall thickness: sufficiently deep or wide pockets
can still intersect one another or pierce the base.

The **Transparent base preview** toolbar toggle is available in every operation
mode. It defaults to 60% base opacity and keeps its setting when you switch modes;
turn it off for an opaque view. Separate inlays remain solid, making their depth
and hidden faces easier to inspect. Raised objects share the base mesh and its
opacity. This affects only the viewport; exported geometry and material colors
are unchanged.

**3MF is recommended.** It contains one aligned assembly per printable body
(base, and lid when enabled), named base/inlay components, shared vertex
indices, and core base-material colors. Slicers may
require explicit material/extruder assignment. This is not a slicer-specific
project file and does not contain printer settings.

STL is a binary fallback without part colors (in the menu beside the 3MF
button). Both formats use millimeters and
convert the editor's Y-up coordinates to conventional Z-up print coordinates.
The base is origin-centered; arrange the assembly on the build plate in the slicer.

Export is disabled until the current settings are successfully built. Invalid
geometry or a completely removed model cannot silently export a previous result.

### Projects And Presets

**Save project** downloads a `.json` file with the full design, including
embedded images, SVGs and uploaded fonts; **Open project** restores it. Loaded files are treated
as untrusted: values are type-checked, clamped or whitelisted, image data must
be a PNG/JPEG/WebP/GIF data URL, and files are limited to 64 MB and 200 objects.
The File menu's presets start from a keychain tag, name plate, hex coaster, dice,
stamp, box with lid or wall sign. Opening a project or preset asks before
discarding unsaved changes.

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
Manifold performs solid booleans, 2D outline unions and extrusion; Three.js
provides rendering, glyph outlines, TTF/OTF parsing (via its bundled opentype.js)
and transform/orbit controls. Bundled fonts retain their upstream license in
[public/fonts/LICENSE](public/fonts/LICENSE) and embedded typeface metadata.

There is no server. Reloading restores the autosaved design. Solid builds run in
a background Web Worker, so dragging and typing stay responsive while large
masks, high tessellation, arrays or many objects rebuild; if the worker cannot
start, builds fall back to the page. WebGL, WebAssembly and module workers are
required. Physical
printing, printer tolerances and third-party slicer compatibility must still be
checked for the intended printer and materials.
