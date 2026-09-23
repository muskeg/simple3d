# Implementation Review And Verification

Review date: 2026-09-20. Updated 2026-09-22 for the feature expansion, UI
reorganization, history/autosave, background builds and arrays (see
[Feature Expansion](#feature-expansion-2026-09-22)). The requirement audit and
defect list directly below describe the original 2026-09-20 delivery.

## Requirement Audit

The original seven requests and rotation clarification were recovered from the
prior session, rather than inferred from the unfinished implementation.

| Requirement | Delivered | Evidence |
| --- | --- | --- |
| Multiple base geometries | Box, elliptical cylinder/cone, ellipsoid, rectangular pyramid | Exact-bounds tests and all 15 shape/mode combinations |
| Typeable, less restrictive dimensions | Strict numeric inputs, soft slider limits, Enter/blur commit and Escape cancel | Browser tests include dimensions beyond slider limits, invalid input and STL measurements |
| Chamfer-inclusive exact dimensions | Every base normalized to the requested complete bounding box | Numerical tests include odd tessellation, asymmetric and sub-millimeter sizes |
| Multiple draggable text objects and face snaps | Add/select/duplicate/delete, click selection, direct drag, gizmos, actual-mesh raycast snapping | Browser pointer tests and slope-normal tests |
| Full quaternion rotation with numeric axis-angle | Euler inspector, quaternion composition, rotation rings, standard/custom world axes | Axis normalization tests and a real ring-drag browser test |
| Font selection | Four local typefaces, selected independently per text object | Browser test verifies per-object state and changed export geometry |
| PNG extrusion/inset masks | Alpha/dark/light contours, holes/islands, replace image, threshold/resolution/width | Pixel-unit tests and actual upload/replace/export browser tests |
| GitHub Actions / Pages | Test-gated build/deploy workflow, subpath-safe fonts and WASM | Static production browser suite passes under `/simple3d/`; remote deployment not executed |

## Defects Corrected

- Viewport model disposal was triggered by an unstable callback on unrelated
  React renders. The callback is stable and model swaps own disposal.
- Object creation changed selection inside React state updaters, causing
  side effects under Strict Mode. Creation/selection updates are now separate.
- Raised geometry started at the surface without the promised overlap and
  extended beyond the requested height. It now overlaps inward and ends at the
  exact outward extrusion height.
- Inset depth was capped by raised extrusion height. Cutting depth is independent.
- Coincident/overlapping inlays occupied duplicate volume. Inlays are allocated
  from the remaining base in list order.
- A topology audit found unmatched edges in the original boolean output, even
  when screenshots and volume checks looked correct. Replaced three-bvh-csg with
  Manifold, not just a visual workaround. Closed indexed topology is now tested.
- Several bases ignored one footprint dimension, and odd tessellation reduced
  their bounds. Every shape now honors all three nominal dimensions.
- Face buttons used bounding-box coordinates for sloped surfaces. They now
  raycast the actual base geometry and align with its surface normal.
- Empty text silently became ABC (or a cube). It now contributes no geometry.
- Mask geometry could cache a missing decode; upload failures were unhandled;
  threshold zero selected transparent pixels. These paths are corrected.
- Replaced the handwritten contour walker with d3-contour for nested holes and
  disconnected regions, and preserved image-center alignment.
- 3MF output used duplicated triangle vertices, independent top-level build
  items, no core material resources, and an unnecessary self-relationship.
  It now uses indexed vertices, an aligned component assembly and material colors.
- Exports could use stale model settings and stale transforms. Both are guarded,
  with consistent Z-up conversion for STL and 3MF.
- Font selection, direct dragging and gizmos were advertised but absent. They
  are implemented and exercised with real browser gestures.
- Fixed selection fallback, last-object deletion, inaccessible numeric controls,
  mobile viewport collapse, and WSL file-change detection.

## Architecture And Ownership

- `src/App.jsx` owns settings, the multi-selection (the last id is the primary
  object), undo/redo history, autosave, keyboard shortcuts and rebuild
  scheduling. Export requires the successfully built settings to be the current
  settings object.
- `src/components/ScenePanel.jsx` (Base/Objects tabs, File menu, export),
  `Inspector.jsx` (selected-object editing, align, arrays, transform) and
  `ui.jsx` (collapsible sections with remembered state, menus, segmented
  controls) form the UI. `NumberField.jsx` provides typed entry and label
  scrubbing. On narrow screens the Inspector is rendered as an Edit tab.
- `src/lib/engine.js` initializes Manifold and converts between Three.js
  geometry and Manifold solids. `bodies.js` builds the base (optionally hollow)
  and lid bodies with 2D offsets. `baseShapes.js` creates centered bases with
  exact extents.
- `src/lib/objects.js` dispatches object geometry (text, image mask, SVG, shape,
  hole) and mirroring. `geometry.js` lays out multi-line text by unioning glyph
  outlines in 2D; `fonts.js` resolves bundled and uploaded TTF/OTF fonts;
  `mask.js`, `svg.js` and `shapes2d.js` produce the other unit prisms.
- `src/lib/csg.js` applies each body's objects (cuts and inlays, then raised,
  then holes, with arrays expanded by `arrays.js`) and serializes the result
  for worker transfer. Temporary WASM solids are deleted, including on error.
- `src/lib/build.worker.js` runs `buildModel` in a module Web Worker;
  `buildClient.js` queues the latest request only and falls back to the page
  if the worker cannot start. SVGs are parsed on the page because workers have
  no DOMParser.
- `src/lib/placement.js` owns face frames, raycast presets and quaternion math;
  `align.js` owns alignment, distribution, centering, nudging and grid snapping.
- `src/lib/project.js` serializes projects and sanitizes untrusted project and
  autosave data; `presets.js` materializes starting designs.
- Objects are authored as unit-height prisms on local XZ, with local +Y as their
  extrusion axis. `pos` is a contact anchor; `rot` is Euler XYZ in degrees.
  World rotations are composed with quaternions before conversion back to state.
- The viewport owns the renderer, camera, controls, raycast proxies (including
  array copies) and displayed model lifetime. Proxies never enter exports.
  Gestures show a temporary overlay and commit settings on release.
- `src/lib/exporters.js` writes a 3MF ZIP (one assembly and build item per
  body) or binary STL, applying world transforms, the lid print layout and a
  right-handed Y-up to Z-up rotation without resizing.

## Verification Performed

All checks below passed locally in Linux/WSL using Node.js 20 and Playwright
Chromium on 2026-09-22. CI is configured for Node.js 22.

| Check | Result |
| --- | --- |
| `npm test` | 99 tests passed |
| `npm run test:e2e` | 25 browser tests passed |
| `npm run build` | Production JS, CSS, worker, local fonts and WASM packaged successfully |
| `npm run test:production` | All 25 browser tests passed against the static build |
| Desktop / mobile screenshots | 1440x900 and 390x844; rendered-model pixel coverage and orbit-induced pixel changes asserted |
| Editor diagnostics | No errors reported |

Browser acceptance coverage includes actual pointer movement, raycast selection,
surface drag, rotation-ring dragging, keyboard mode changes, independent fonts,
PNG upload/replacement, invalid-image recovery, numeric editing/cancel/rejection,
all base dimensions measured from binary STL, all operation modes and a real 3MF
download. ZIP structure, transforms, units, components and welded vertices are
also tested independently. Closed-topology assertions require two incident
triangles per indexed output edge; volume tests cover identical and partially
overlapping inlays.

Vite reports a large main JS chunk (about 1.3 MB, 365 kB gzipped; the worker
chunk is a further 426 kB) and a browser-externalized `node:module` reference
inside the upstream Manifold wrapper. The browser-only WASM path was verified
by the static-production suite in both the page and the worker; these messages
are not runtime failures.

## Validation Boundaries

- The remote GitHub workflow and public Pages URL have not been executed or
  verified in this review. Pages must be enabled and the changes pushed first.
- No physical print or third-party slicer round trip was performed. 3MF uses
  standard core materials/components, not proprietary slicer configuration.
- Automated browser coverage is Chromium. Firefox, Safari and actual touch
  hardware have not been separately tested. Mobile coverage is a narrow
  viewport in Chromium, not a claim of device-specific certification.
- Numerical tests cover representative dimensions and shapes, not every possible
  intersection or pathological raster. Geometry is floating-point. Manifold
  rejects invalid input instead of silently exporting a malformed result.
- Surface snapping aligns rigid geometry; it is not curved-text wrapping. Array
  copies, alignment and grid snapping also work in flat planes and can lift off
  curved bases. Free placement can intentionally yield disconnected bodies.
  Inspect connectivity and appropriate manufacturing tolerances in the slicer.
- Builds run in a module worker. Image masks in the worker need
  `createImageBitmap` and `OffscreenCanvas`; browsers lacking them in workers
  (older Safari) will report a build error for image objects rather than
  falling back. Only Chromium was tested.
- Hollow shells are uniform for boxes and N-gons; elliptical footprints are
  offset along the outline normal. Lid clearance, lip fit and wall strength
  have not been validated by printing.
- Autosave uses `localStorage`; designs with large embedded images or fonts may
  exceed the quota, in which case autosave pauses with a notice. Undo history
  is in memory only and does not survive a reload.
- Uploaded fonts are parsed by Three.js's bundled opentype.js. Kerning is not
  applied, and glyph coverage depends on the font.
- Curved text, heightmap relief, print checks and additional export formats are
  not delivered features.

## Deployment Gate

Pull requests run numerical tests, production build and production browser tests.
A successful push to `main` (or manual run on `main`) publishes the checked
`dist/` artifact via GitHub Pages. Failed tests prevent deployment; failure
artifacts retain browser screenshots/traces. No remote push is performed by this
review itself.

## Depth-Controlled Inlays Follow-Up

The user subsequently pushed the application to main and confirmed that slicer
import works. They identified the original full-thickness flush inlay behavior
as unsuitable for multi-face objects such as dice.

Flush inlays now form surface-anchored pockets, with independent `inlayDepth`
values for each text/image object (default 2 mm). The selected-object inspector
shows Inlay Depth instead of the irrelevant raised Extrusion Height in flush
mode. The cutter extends only 0.05 mm outside the anchor to cross the surface;
the intersected inlay finishes at the actual base surface. Depth follows the
object's quaternion orientation and does not recenter the cutter on the base.

New regressions cover an arbitrary rotated anchor, six pockets of different
depths on a cube, preservation of the original solid volume, and actual 3MF
downloads containing independently controlled top/bottom inlay depths. The cube
case uses depths of 0.5-3 mm on a 20 mm base, preserving its core. Excessive depths
can still intentionally pierce the base or intersect another pocket; no automatic
wall-thickness or collision constraint is implied.

Follow-up verification passed: 39 numerical tests, the focused depth-control
browser test, the production build and all 9 production browser tests. No new
remote deployment or slicer validation was performed for this depth change.

## Viewport Inspection Follow-Up

All operation modes offer a translucent base preview (60% opacity) with a
persistent toolbar toggle; separate inlays remain opaque. Raised objects share
the base mesh's opacity. This is a display-only material change.
A browser pixel test verifies that hidden inlays become visible and that the
exported STL geometry is unchanged when the preview is toggled.

A bottom-right Three.js ViewHelper provides clickable signed axis endpoints for
animated camera alignment. It follows orbit orientation and preserves camera
distance and the orbit target. Its overlay captures its own pointer gestures so
axis clicks cannot drag objects. Orbit and transform controls are suspended only
during alignment, and helper GPU resources are disposed with the viewport.
Six browser cases verify alignment in each signed direction, unchanged object
state/exports and recovery of free orbit; the bottom-view case also uses a mobile
viewport. Negative endpoints are labelled and colored for the dark background.

## Feature Expansion (2026-09-22)

Three batches were requested in conversation after the original delivery, each
planned with the user before implementation. Commits: `cbc0989` (objects,
bases, shell/lid, projects), `2338bb1` (UI, alignment, text), `354c438`
(history, autosave, worker, arrays), plus the empty-space deselection change.

| Request | Delivered | Evidence |
| --- | --- | --- |
| Per-object mode, mirror | Default/raised/inset/flush per object with own depths; mirrored geometry with corrected winding | Mixed-mode volumes; mirrored solids stay closed with positive volume |
| Holes, shapes, SVG | Through holes (plain/countersink/counterbore) that also cut inlays and raised parts; six 2D shapes with exact footprints; SVG fills unioned in 2D | Exact hole volumes; footprint tests per shape and mode; SVG upload including an embedded `<script>` that must not run |
| More bases | N-gon prism, tube, torus; face presets land on the ring of hollow-centered bases | Exact-bounds and all shape/mode tests; ring-placement tests |
| Hollow shell and lid | Offset cavity (open/closed); plate + lip with clearance; separate 3MF build item; print layout preview/export | Exact cavity and lid volumes; lip width measured; 3MF has two build items; STL spans the laid-out pair |
| Save/load, presets | Validated JSON projects (images, SVGs, fonts embedded); seven presets | Round-trip and hostile-input tests; every preset builds a closed model; save/open/new browser flow |
| UI reorganization | Base/Objects tabs, Inspector (Edit tab on mobile), File menu, export split button, collapsible remembered sections, label scrubbing | Full browser suite rewritten against the new layout at desktop and mobile widths |
| Align tools | Multi-select, group move, align min/center/max, distribute, center on face/body, grid and angle snap, keyboard nudge/delete/duplicate/escape | Bounding-box math tests; browser flow for select, align, distribute, nudge and shortcuts |
| Text controls | Multi-line, alignment, letter/line spacing, TTF/OTF upload | Exact spacing and alignment tests with a generated OTF; upload, invalid font and project persistence in the browser |
| Undo/redo, autosave | 100-step history with per-field coalescing; validated autosave restore | Browser test covers field steps, one-step scrubbing, keyboard undo/redo and reload restore |
| Background builds | Module worker with latest-only queue and page fallback | Browser test asserts the worker path is active in dev and production |
| Arrays | Linear, grid and circular (sweep, rotate copies); per-copy inlay parts; convert to objects | Placement and cap tests; arrayed inlays and holes volume test; browser export and conversion |
| Deselect on empty click | A click on empty viewport space (not an orbit drag) clears the selection and hides the gizmo | Browser pixel test: gizmo pixels disappear after a click but not after an orbit |
| Hole depth | Through all, First wall (depth probed from the pre-object body at the shaft center and 12 rim points, stopping before any further wall) or Fixed depth | Exact volumes for one wall of a hollow box, solid-body equivalence and blind holes; a radial hole in a hollow cylinder matches a deliberately deep cut, while a center-line-only depth leaves rim material; browser volume check from STL |

### Defects Found During The Expansion

- A file conflict dropped the `NonZero` fill rule from the shell/lid outline
  sections. It was restored and verified with the full suites.
- The original text path (Three.js `TextGeometry`) extruded each glyph contour
  separately, so overlapping letters (tight spacing, some fonts) would produce
  self-intersecting input. Glyph outlines are now unioned in 2D first.
- SVG parsing relies on `DOMParser`, which workers do not provide. SVG polygons
  are parsed on the page and sent to the worker.
- History coalescing initially merged edits to different fields, and slow
  scrubs were split into several steps. Steps now split when the set of changed
  fields changes, and commits wait for pointer gestures to end.
- Icon-only segmented buttons without icons rendered empty (the align-axis
  control). They now fall back to their text labels.
- Clicking empty viewport space kept the selection, so the gizmo could not be
  hidden without the Escape key. Empty clicks now deselect.

### Verification

On 2026-09-22: 99 numerical tests, 25 development browser tests, a production
build and 25 production browser tests passed. New numerical suites are
`features.test.js`, `ux.test.js` and `arrays.test.js`; `tests/fixtures/font.js`
generates an OTF at test time instead of committing a binary font. No push,
remote deployment, slicer import or physical print was performed for these
changes.