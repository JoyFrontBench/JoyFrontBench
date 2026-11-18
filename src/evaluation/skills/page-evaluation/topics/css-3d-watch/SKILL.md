---
name: css-3d-watch-eval
description: Evaluate offline single-file CSS/SVG 3D skeleton watches with real Z-layered structure, countable horology details, coaxial hands, measurable gear meshing, drag-and-support integrity, CSS-driven movement, and chronograph behavior.
---

# CSS 3D Watch Eval Skill

Use this skill for `frontenjoyai-013` and similar code-built skeleton-watch exhibits.

Treat the task and `criteria` as the contract. Score only the seven judge rows and their child criteria. Preserve other explicit task requirements as task-level evidence, but do not manufacture additional child scores for them.

Use GPT-5.6 Sol implementations to discover selectors, inspectable state, and common defects. Do not require their DOM names, gear layout, data attributes, animation structure, or visual design from other valid candidates.

Default method: open the delivered file directly, block/capture network requests, use Playwright at `1440x900` plus task-level `390x844`, inspect DOM/CSS/SVG, sample computed transforms and pixels over time, drag the exhibit, and run the complete chronograph state sequence.

## Evidence Anchors

Useful optional anchors include:

- `#world`, `#watch`, `#gears`, `#crown`, `#pushA`, `#pushB`, `#chronoHand`, `#chronoMinute`, `#chronoReadout`, and `data-state`, `data-chrono`, `data-elapsed`;
- `#exhibit`, `#turntable`, `#machine`, `#gearTrain`, `#crown`, `#pusherA`, `#pusherB`, `#chronoCentral`, `#subdialHand`, `#chronoReadout`;
- gear metadata such as `data-teeth`, `data-module`, `data-period`, `data-direction`, and `data-mesh`.

Equivalent selectors and state exposure are valid. Metadata is an evidence lead, not proof: independently measure geometry, depth, motion, and state transitions.

## Scoring And Technical Boundary

For the seven judge rows, keep evidence attached to the matching child criterion. Record these explicit task-level checks separately:

- exactly one directly openable HTML file, no runtime network, external assets, Canvas, WebGL, Three.js, or other 3D libraries;
- perspective plus `preserve-3d`, with major layers separated by real `translateZ`;
- base train gears, balance, escapement, hour/minute/going-seconds hands driven continuously by CSS animation or SVG SMIL;
- JavaScript limited to discrete state, drag view, one-time static DOM generation, and allowed chronograph RAF updates;
- balance oscillation, escapement semantics, winding, reserve depletion/recovery, setting mode, double-click view reset, narrow layout, and long-run stability;
- original branding/design and an accessible name/description on the whole watch or root SVG.

Task-level failures may support an affected judge criterion where directly relevant, such as JS replacing the CSS movement during drag or chronograph use. Do not otherwise add a new score row.

## Static 3D Structure

At the initial oblique view:

- require visible case thickness, at least two bezel heights, side/bottom structure, connected thick upper and lower lugs, a textured crown and connector protruding from the right side, restrained contact shadow, and a transparent crystal at the highest layer;
- require a genuinely open-worked center and plausible depth order: base plate -> gears/balance/escapement -> bridges -> chapter ring -> hands -> crystal;
- verify multiple distinct Z layers through computed transforms and rotated screenshots; the coordinate origin and sign convention are implementation-defined.

`z-index`, DOM order, shadows, blur, or gradients do not substitute for `translateZ`. A wrapper that tilts one flat illustration does not create a valid 3D movement.
Audit the required 3D ancestor chain for grouping properties that flatten descendants, including non-visible/clip overflow, filters, opacity, masks/clip paths, isolation, blending, or paint containment. Use rotated screenshots and changing occlusion/parallax to prove the used 3D context remains spatial rather than relying on `transform-style` declarations alone.

Count and visually verify:

- exactly 12 major hour markers and exactly 60 minute positions, with the 12 five-minute positions emphasized;
- at least 3 visible bridges above the train;
- at least 5 slotted/highlighted screws;
- at least 4 jewel bearings at plausible axes/supports;
- at least 5 main gears with visible teeth, rim, spokes, axle, and thickness.

Counts alone are insufficient when parts are hidden, decorative, swallowed by darkness, or unrelated to the mechanism.
Inspect repeated ticks, teeth, screws, and jewels for sensible CSS classes, SVG reuse, or one-time DOM generation while preserving visible variation in size, position, material, depth, or local structure.
Measure marker angles and radii: the 12 and 60 positions must be unique, evenly spaced on concentric rings, and the same 12 five-minute positions must carry the emphasis rather than overlapping duplicate nodes.

## Materials And Visual Judgment

Capture initial and rotated detail views. Require:

- readable cold case metal, warm gears/bridges, dark movement, red jewel accents, and transparent glass as distinct material roles;
- sharp teeth, bridge edges, axes, hands, and case silhouette at normal brightness;
- high-end industrial/horology presentation rather than a neon dashboard, card UI, cartoon watch, or nearly black composition;
- depth caused by structure and occlusion, with glass highlights restrained enough to preserve the movement.

For judge row 3, score its actual visual child criterion. Keep mobile framing and two-minute stability as task-level evidence unless the current `criteria` explicitly adds them.

## Hands And Fixed Axes

Inventory separate hour, minute, and second groups. Verify:

- a shared rendered center, distinct lengths/thicknesses, raised center cap, and distinct Z heights;
- periods near `43200s`, `3600s`, and `60s`, preserving hour < minute < second speed;
- placement above movement/bridges and below the crystal;
- rotation around one fixed dial-normal axis without translation or accumulated drift.

Sample computed matrices and screenshots at several timestamps, including positions under strong glass highlights, and verify the three hands are not persistently obscured. Inspect keyframes as well as static rules: animation on an element replaces its normal `transform`, so keyframes must preserve required positioning/Z. An outer rotor that rotates while an inner hand carries `translateZ` is equally valid and must not be rejected.

## Gear Geometry And Motion

Build an inventory containing each gear's measured center, pitch/tooth radius, tooth count, tooth size/module estimate, Z depth, direction, period, and candidate mesh neighbors.

Require:

- at least five simultaneously visible thick gears spanning large/medium/small sizes, different regions, and multiple real Z depths;
- at least three actual meshing pairs whose center distance is approximately the sum of pitch radii, whose tooth pitch/module is compatible, whose tooth bands overlap in Z, and whose teeth interleave without large gaps or overlap;
- opposite directions for adjacent meshing gears;
- angular speed approximately inverse to tooth count and at least three distinct periods, with the smallest main gear visibly fastest;
- every main gear moves continuously around its fixed axis, with stable mesh across time and an animation-loop boundary.

Do not accept `data-teeth`, `data-module`, `data-period`, `data-direction`, or `data-mesh` without recomputing the relationships. Do not count `z-index` as depth.

Inspect animation ownership carefully:

- if the positioned gear itself is animated, every keyframe must preserve its center translation and Z placement;
- if an inner rotor is animated, its outer positioned shell may hold the center/Z;
- reject keyframes that overwrite the positioning transform and pull multiple gears to a common origin;
- sample short-interval matrices and rendered centers, not only declared animation durations.

## Balance And Escapement Task Evidence

Verify a thick balance wheel oscillates between positive and negative angles rather than rotating continuously through `360deg`. Verify an escape wheel advances in visible steps and a pallet/fork rocks through a small angle. Their periods must share a base cadence or an integer relationship, and motion must continue during drag and chronograph use.

Keep this as task-level evidence unless it directly supports a judge child such as continued CSS/SMIL movement during interaction.

## Drag And Support

1. Record the initial whole-scene matrix, watch/support geometry, and several movement transforms.
2. Start horizontal and vertical drags on the visible watch area using mouse or touch/pointer input.
3. Require continuous X/Y perspective change, no jump, and persistence after release.
4. During and after drag, sample gears, balance, escapement, and hands to prove CSS/SMIL movement continues.
5. Verify the stand/cradle/base and watch rotate as one assembly while preserving contact and relative geometry.

Changing a class or CSS variable without a visible view change is insufficient. A support that remains behind in screen space, floats away, intersects the case, or is merely a background decoration fails the support relationship.

## Chronograph State Machine

Exercise a timestamped sequence:

1. Initial `idle`: central chrono hand, accumulator subdial, and readout are zero.
2. Press A: state becomes running and all three derived displays advance from the same elapsed value.
3. Press A again: state becomes stopped and all displays freeze while retaining accumulated time.
4. Press A again without resetting: running must resume from the retained accumulated position, then press A to stop again.
5. Press B while stopped or idle: all derived displays reset to zero.
6. Start again and press B while running: enter split hold without resetting the underlying timer.
7. Wait, confirm the displayed value remains held, then press B again and require the display to catch up to actual elapsed time.
8. Throughout, verify the normal hands, gear train, balance, and escapement continue independently under CSS/SMIL.

Allow chronograph `requestAnimationFrame`; reject RAF or timers that take over the base movement. Do not infer correctness from button labels or `data-*` state alone: compare readout, central hand angle, subdial angle, and elapsed timing.

## Winding, Reserve, And Setting Task Evidence

Record separately:

- dragging the crown while running increases a visible reserve value/indicator;
- reserve decreases during running, reaching zero stops the base train and hands, and winding above zero restores them;
- pulling the crown enters setting mode and pauses base movement including the balance;
- dragging in setting mode changes hour/minute transforms, and pushing back resumes from the adjusted time;
- labels or data attributes are not accepted without matching transform/animation changes.

Use an exposed test seam or temporarily controlled clock only when needed to reach reserve zero; document the intervention.

## Offline, Responsive, And Stability Task Evidence

- Open via `file://` where browser policy permits and record every non-file request; require none.
- Inspect source for prohibited external URLs, Canvas/WebGL/Three usage, and JS frame loops driving base movement.
- Double-click the watch/exhibit away from crown controls and verify the presentation view returns to its initial angle without resetting the movement or chronograph.
- At `390x844`, require the full watch, crown, lugs, stand, and shadow to remain visible without horizontal scrolling or flattening.
- Sample after at least two minutes or use animation-time controls to cross loop boundaries; check fixed centers, no speed drift, no transform accumulation, and preserved Z layers.

These are task-level checks under the current seven-row judge unless a child criterion directly covers the observed failure.

## Reference-Test Limits

The completed OpenCode tests prove basic element counts, containment at two viewports, one short chronograph start/stop/reset flow, setting-state labels, console cleanliness, and no network requests. They do not prove actual Z depth, exact marker emphasis, gear mesh geometry, tooth-speed ratios, fixed axes, drag/support integrity, split behavior, CSS ownership of base movement, winding/depletion recovery, escapement semantics, or long-run stability.

## Observation Protocol

Move the camera before judging any three-dimensional structural claim. The default framing hides depth, so a front-on capture cannot settle whether a raised feature exists.

- Rotate or drag the watch to an oblique and a side view, then judge the center-axis question — raised cap, jewel bearing, hand-to-hand and hand-to-dial height differences — from those captures.
- A missing raised structure is only a fail once the oblique views confirm it is absent; do not fail it from the default view, and do not pass it without having looked.
- Judge the display support from the same rotated captures. A visible dark support behind the watch that turns with the whole assembly satisfies the support point.
- Do not let a `0x0` container measurement override what the rotated screenshots plainly show. Geometry probes on wrapper elements are unreliable for 3D-transformed scenes; prefer the visual evidence and say so in the reason.

## High-Risk False Passes

- Correct `data-*` gear metadata with visibly wrong center distances, modules, directions, or periods.
- All gears are coplanar, or `z-index` is presented as mechanical depth.
- Gear or hand keyframes overwrite static translation/Z and move parts to a shared center.
- Counts pass but most parts are hidden or decorative circles without teeth/thickness.
- Drag rotates only the watch while the stand separates, or stops the base animations.
- Balance rotates continuously, escapement is static, or both are unrelated animation ornaments.
- State labels change for winding/setting while reserve and transforms do not.
- Chronograph start/stop works, but running B resets instead of split hold or exiting split fails to catch up.
- Chronograph RAF also drives the normal movement.

## Recommended Evidence

- `watch-delivery-and-animation-boundary.json`
- `watch-component-z-inventory.json`
- `watch-hand-transform-samples.json`
- `watch-gear-mesh-audit.json`
- `watch-balance-escapement.json`
- `watch-drag-support-state.json`
- `watch-chronograph-timeline.json`
- `watch-winding-setting-task-evidence.json`
- initial, rotated, movement-detail, and narrow screenshots

## Alignment-Focused Adjudication

Calibrate 3D-watch conclusions with matched oblique, side, and rotated views. Treat CSS declarations and semantic part names as candidate evidence; confirm depth through changing occlusion/parallax and visible mechanical continuity. For controls and chronograph behavior, record an uninterrupted state sequence and compare both UI state and rendered hands/readout. Count only parts that are visibly distinct at the judged scale, but do not impose a particular DOM decomposition where equivalent generated or reused geometry produces the required observable structure.
