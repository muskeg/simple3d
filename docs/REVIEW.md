# Implementation Review And Verification

Review date: 2026-09-20.

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

- `src/App.jsx` owns editor settings, selection, font/engine initialization and
  debounced rebuilds. Export requires the successfully built settings to be the
  current settings object. There is no persisted project state.
- `src/lib/baseShapes.js` creates centered bases and enforces final extents.
  `src/lib/geometry.js` creates the rounded-box outline and unit-prism text.
- `src/lib/placement.js` owns face frames, raycast presets and quaternion math.
- `src/lib/mask.js` decodes images and traces alpha/luminance contours. Cached
  geometry is borrowed; consumers clone before mutating or disposing it.
- `src/lib/csg.js` initializes Manifold once, converts input meshes into solids,
  performs booleans, and returns a Three.js group. Temporary WASM solids are
  explicitly deleted, including error paths.
- Objects are authored as unit-height prisms on local XZ, with local +Y as their
  extrusion axis. `pos` is a contact anchor; `rot` is Euler XYZ in degrees.
  World rotations are composed with quaternions before conversion back to state.
- The viewport owns the renderer, camera, controls, raycast proxies and displayed
  model lifetime. Proxies never enter exports. Gestures show a temporary overlay
  and commit settings on release, avoiding a boolean rebuild per pointer event.
- `src/lib/exporters.js` writes a standard 3MF ZIP or binary STL. Export applies
  world transforms and a right-handed Y-up to Z-up rotation without resizing.

## Verification Performed

All checks below passed locally in Linux/WSL using Node.js 20 and Playwright
Chromium. CI is configured for Node.js 22.

| Check | Result |
| --- | --- |
| `npm test` | 37 tests passed |
| `npm run test:e2e` | 8 browser tests passed |
| `npm run build` | Production JS, CSS, local fonts and WASM packaged successfully |
| `npm run test:production` | All 8 browser tests passed against the static build |
| Desktop / mobile screenshots | 1440x900 and 390x844; rendered-model pixel coverage and orbit-induced pixel changes asserted |
| Editor diagnostics | No errors reported |
| Dependency audit during installation | No known vulnerabilities reported |

Browser acceptance coverage includes actual pointer movement, raycast selection,
surface drag, rotation-ring dragging, keyboard mode changes, independent fonts,
PNG upload/replacement, invalid-image recovery, numeric editing/cancel/rejection,
all base dimensions measured from binary STL, all operation modes and a real 3MF
download. ZIP structure, transforms, units, components and welded vertices are
also tested independently. Closed-topology assertions require two incident
triangles per indexed output edge; volume tests cover identical and partially
overlapping inlays.

Vite reports a large main JS chunk and a browser-externalized `node:module`
reference inside the upstream Manifold wrapper. The browser-only WASM path was
verified by the static-production suite; these messages are not runtime failures.

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
- Surface snapping aligns rigid geometry; it is not curved-text wrapping. Free
  placement can intentionally yield disconnected bodies. Inspect connectivity
  and appropriate manufacturing tolerances in the slicer.
- Complex masks and large object collections are synchronous main-thread work.
  Resolution/tessellation limits bound individual inputs, not total scene cost.
- Undo/redo, project save/load and curved text are not delivered features and
  were not part of the recovered requirements.

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