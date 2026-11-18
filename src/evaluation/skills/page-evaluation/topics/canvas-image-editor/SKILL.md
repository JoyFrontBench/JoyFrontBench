---
name: canvas-image-editor-eval
description: Evaluate local Canvas image editors with real pixel exports, separated edit state, stable image-space coordinates, crop/rotate/flip transforms, filters and mosaic algorithms, editable annotations and layers, undo/redo/reset/comparison, project persistence, and PNG/JPEG export.
---

# Canvas Image Editor Eval Skill

Use this skill for `frontenjoyai-027` and similar local image-editing workbenches.

Default method: run editor/domain tests, then use a known local fixture with coordinate markers and distinct colors. Parse project JSON and exported image pixels/dimensions; screenshots alone cannot prove pixel processing.

The task judge is authoritative. Treat implementation-specific names below as optional evidence entrances, not required architecture.

## Stable Evidence Entrypoints

- Canvas: `[aria-label="照片编辑画布"]` or the equivalent primary editing canvas.
- Commands: accessible names for import/sample, crop apply/cancel, rotate/flip, undo/redo, reset, save project, project JSON, PNG, JPEG, fit, and `100%`.
- Tools and panels: `[aria-label="编辑工具"]`, tool buttons with `aria-pressed`, layer visibility/lock buttons, crop ratio controls, adjustment labels, and export settings.
- Persistence: IndexedDB database/store/key equivalent to `pixel-workbench` / `projects` / `latest`.
- Download evidence: project JSON plus decoded PNG/JPEG. A public debug object is not required; prefer exported structured state and pixel files.

Record discovered selectors when names differ. Do not use visible status text as the sole proof of a state or export change.

## Engineering And State Boundary

- Confirm project/build/test/typecheck or lint scripts and importable coordinate, crop, pixel, layer, history, persistence, and export logic.
- Require Canvas 2D or equivalent local rendering and no remote image/storage/processing API.
- Reject CSS filter as the final edit path; exported PNG/JPEG pixels must contain adjustments, mosaic, crop, and visible annotations.
- Identify separated state for original bitmap, non-destructive adjustments, crop/orientation, local pixel operations, annotation layers, history, and export settings.
- Original bitmap must remain recoverable until reset/reimport.

Inspect a project/state shape equivalent to:

- image metadata: name/type/size/original width/original height;
- editor state: current width/height, adjustments, layers, selected id, crop/orientation or an equally explicit transform representation;
- layer: id/type/x/y/width/height/points/rotation/stroke/fill/line width/opacity/text/font size/visible/locked/z-index and mosaic block size where applicable;
- export config: annotations, background, quality, scale, and format;
- versioned project envelope with embedded image data or verifiable source-image identity.

Missing required semantics cannot be excused because the reference collapses a transform into a bitmap source.

## Preview And Export Consistency

Create a compound edit:

1. apply a clearly visible global adjustment;
2. crop;
3. add mosaic;
4. create rectangle, arrow, text, and brush annotations;
5. hide one layer;
6. export PNG and JPEG.

Reopen exported files and compare dimensions and sampled pixels with the preview renderer. All visible edits must appear, hidden layers must not, and view zoom/pan must not affect output size.

Discover the candidate's actual compositing order and trace both preview and export from the same authoritative edit state. Compare the resulting pixels for global adjustments, mosaic operations, z-ordered visible layers, and export options. Separate preview/export render functions or a different documented operation order are valid when their semantics and output remain consistent.

## Coordinates And Navigation

- Exercise zoom in/out, fit, and `100%`; verify displayed zoom.
- Pan with Space/hand tool and zoom around pointer/center without jumps.
- At `50%`, `100%`, `200%`, and after pan, click the same image-space marker and compare selected object/control point/cursor pixel coordinate.
- Save screen-to-image and image-to-screen transforms plus view box.
- Export after extreme pan/zoom and require unchanged image-space geometry.

Read the candidate's actual viewport transform before deriving expected coordinates. Account for its canvas bounds, image/content origin or centering offset, pan convention, zoom anchor, CSS scaling, and device-pixel ratio, then verify forward and inverse mapping with known points. For a simple top-left logical-coordinate implementation, `(screen - canvasBounds - pan) / zoom` is one valid example, not a required formula; equivalent affine or `DOMMatrix` transforms are valid. A CSS-transformed overlay that looks aligned only at one zoom is insufficient.

## Crop, Rotate, And Flip

- Exercise free, original, `1:1`, `4:3`, `16:9`, `3:4`, and custom ratios.
- Drag edges/corners beyond image bounds and require clamp plus live output dimensions.
- Cancel must leave image/state unchanged; apply must transform or remove outside annotations according to documented rules.
- Test clockwise/anticlockwise `90`, `180`, horizontal and vertical flip.
- Verify image and annotations transform together; four 90-degree turns return to original dimensions/orientation.

Check invariants, not only screenshots: crop stays within `[0,width] x [0,height]`; applied dimensions equal the bounded crop; each 90-degree turn swaps width/height; four identical quarter turns restore dimensions, layer geometry, points, and orientation within tolerance.

## Pixel Algorithms

- Apply brightness/contrast/saturation or current global adjustments and inspect actual output pixel changes.
- Reset individual/all adjustments and verify deterministic restoration.
- Mosaic must replace region pixels by block averages or an equivalent real algorithm, be deterministic, and remain in export.
- Compare mosaic under multiple zoom levels to ensure its region is image-space, not screen-space.
- Reject a translucent checker overlay that leaves underlying pixels unchanged.

Use a tiny synthetic fixture with known RGBA values. Assert the input buffer remains unchanged for non-destructive adjustments, repeated parameters produce identical output bytes, pixels outside the mosaic region remain unchanged, and the region matches the candidate's documented real pixelation algorithm. Block averaging, representative sampling, or deterministic downscale/upscale are valid; compare block aggregates only when that is the implemented algorithm.

## Tools, Layers, And History

- Create and edit rectangle, arrow, text, brush, and mosaic operations.
- Test empty text, pointer cancel, drag outside Canvas, and zero-size objects without stuck tool state.
- For annotations, inspect stable id, type, geometry/points, rotation, stroke/fill, line width, opacity, text/font, visible, locked, and z-index fields.
- Test topmost hit selection, reorder, lock, hide, and delete from both Canvas and layer panel.
- Locked/hidden objects must not be selected or exported contrary to the specification.
- Undo/redo every major operation, branch after undo and require redo clear, and verify reset returns to imported state.
- Original/current comparison must be temporary and must not mutate history or export.

## Project Persistence And Export Panel

- Save/reload a non-default project and compare image metadata, transforms, pixel operations, layers, history boundary, and export config.
- Inject malformed/old project data and require validation/default filling or safe rejection.
- Validate PNG/JPEG quality/background/dimensions/name options and repeated export freshness.
- At `360px`, keep core import, navigation, edit, history, layer, and export controls accessible.

For scale `s`, decoded output dimensions must be `round(currentWidth*s)` by `round(currentHeight*s)`. IndexedDB presence, a success message, or a `.json` filename alone does not prove full restoration; reload and compare state plus rendered pixels.

## High-Risk False Passes

- Preview uses CSS effects while export contains the original bitmap.
- Annotation positions drift after crop/rotation or zoom.
- Mosaic is a visual overlay rather than pixel transformation.
- Hidden layer disappears from the panel but remains in export.
- Undo stores only Canvas snapshots and cannot restore structured layers/settings reliably.
- Unit tests cover one-pixel brightness or one mosaic block but never compare a compound preview against the downloaded image.
- Selection boxes are DOM overlays in screen coordinates and drift from image-space layers after zoom, pan, crop, or rotation.
- Project import validates only top-level fields while accepting malformed layer geometry, dangling selection, or invalid adjustment ranges.

## Recommended Evidence

- local coordinate/color fixture
- `image-editor-state-model.json`
- `image-editor-coordinate-audit.json`
- `image-editor-transform-history.json`
- exported project JSON, PNG, and JPEG with pixel audit
- desktop/mobile editor screenshots

## Alignment-Focused Adjudication

Evaluate editor capabilities through exported pixels and serialized document state, not only toolbar presence or TypeScript interfaces. Create each annotation with non-default style values, transform it, serialize/reload, and compare its visible bounds and properties. Rotate/flip repeatedly while tracking image and annotation coordinates; verify round-trip invariants after four quarter turns. For mosaic, compare sampled exported pixels inside and outside the region and after region transforms to distinguish true pixelation from a translucent overlay. Build/script criteria require actually running the declared commands and recording exit results; filenames alone are not proof.
