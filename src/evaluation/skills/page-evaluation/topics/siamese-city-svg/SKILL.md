---
name: siamese-city-svg-eval
description: Evaluate responsive SVG illustrations of a recognizable Siamese cat before a layered Manhattan skyline, including anatomy, breed markings, city detail, atmospheric perspective, semantic groups, occlusion, lighting, and texture.
---

# Siamese City SVG Eval Skill

Use this skill for `frontenjoyai-006` and similar editorial SVG scenes combining a foreground animal, middle-ground window/terrace, and distant city.

Default method: SVG DOM/source audit plus desktop and narrow screenshots. The judge defines the required result; reference group IDs below are optional evidence hooks and must not be treated as the only valid component structure.

## Discover And Inventory

Require semantic `<g>` layers for sky/background, skyline, window/sill/terrace middle ground, and cat foreground, with nested cat subparts and independently locatable buildings. Exact IDs are flexible; useful reference candidates are `#sky-background`, `#skyline`, `#distant-city`, `#middle-city`, `#near-city`, `#window-architecture`, `#windowsill`, `#plant`, and `#cat`, with cat subgroups such as head, ears, eyes, body, legs, and tail.

Record:

- SVG `viewBox`, `preserveAspectRatio`, rendered bounds, and horizontal overflow;
- semantic plane groups and their DOM/render order;
- cat subparts and independently identifiable buildings;
- gradients, filters, patterns/symbol reuse, and the visible element each affects.

Do not award visual quality merely because these source features exist.

## Subject And Skyline

- Capture a full scene and a close cat crop. Require a natural slender seated anatomy, upright triangular ears, light body, dark face/ear/leg/tail points, and blue almond eyes. A generic silhouette or mascot with blue eyes is insufficient.
- Verify the cat remains the foreground focal point and has internal fur, face, limb, and contact-shadow detail.
- Inventory several visibly distinct Manhattan building types: spire, crown, glass tower, water tank, or equivalents. Do not use group names alone as evidence.
- Require visible windows, rooftop structures, glass/reflection or facade detail, and some warm lit windows.
- Compare representative far/mid/near buildings for size, contrast, saturation, detail density, opacity, and blur. Distant buildings must become simpler, lighter/cooler, and hazier; a uniformly sharp row fails depth.

## Composition And Responsive Closure

1. Confirm readable foreground cat, middle-ground window/sill/terrace/plant, and background skyline/sky.
2. Verify visible occlusion and DOM order are consistent: background behind skyline, skyline behind middle ground, cat in front. DOM order supports but does not replace screenshot evidence.
3. Compare cat/window/building bounding boxes and screenshots for near-large/far-small relationships and impossible intersections.
4. Render at a desktop viewport and `390x844`; verify proportional scaling, no stretch, no subject crop, and no horizontal scrolling. A `viewBox` declaration alone is insufficient.

## Lighting And Material Judgment

Model-judge one coherent time of day, light direction, and color temperature across sky, buildings, cat, and sill. Require visible gradient modeling, haze/glow, glass reflection, lit-window glow, fur point transitions, and a contact shadow. Inspect screenshot crops to prove the declared gradients/filters affect the intended objects.

## High-Risk False Passes

- Treating blue eyes and dark ears alone as sufficient Siamese anatomy.
- Passing “Manhattan” from one pointed tower surrounded by repeated blocks.
- Passing depth because groups are named far/mid/near while all layers render equally sharp.
- Passing occlusion based on DOM order when the screenshot shows incorrect overlap.
- Passing responsive behavior from `viewBox` alone without resizing.
- Counting generated/reused windows as detail without checking that they are visible at the judged scale.

## Recommended Evidence

- `siamese-target-and-structure.json`
- `siamese-layer-order.json`
- `siamese-depth-samples.json`, `siamese-responsive-bboxes.json`
- desktop/narrow full screenshots
- cat, skyline, and overlap detail crops

## Alignment-Focused Adjudication

Depth must be established from the rendered scene by comparing multiple representative near, middle, and far buildings. Record visible differences in scale, overlap, detail density, contrast, saturation, sharpness, and atmospheric fading; group names, blur filters, or opacity values are leads rather than proof. Inspect the full composition and matched crops at the same scale so a foreground cat or window frame does not conceal whether the skyline itself has layered depth. Distinguish deliberate stylization from a flat row, but require at least two converging visual depth cues before concluding that aerial perspective is present.
