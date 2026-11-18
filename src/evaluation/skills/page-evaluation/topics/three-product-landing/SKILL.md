---
name: three-product-landing-eval
description: Evaluate Three.js product landing experiences with a programmatic can, deterministic Canvas label, three persisted themes, loading and scroll narrative, mutually exclusive interaction states, drag/inertia/shake/inspect controls, lifecycle cleanup, and responsive visual quality.
---

# Three.js Product Landing Eval Skill

Use this skill for `frontenjoyai-016` and similar interactive 3D beverage/product pages.

Treat the task and `criteria` as the scoring contract. A reference solution may reveal useful probes and failure boundaries, but its component names, classes, storage keys, copy, and architecture are never the only legal implementation.

Default method: Playwright screenshots and frame/state sampling plus source, network, and resource-lifecycle inspection. Keep full-page evidence for layout and close crops or canvas samples for product details.

## Evidence Anchors

Prefer semantic roles and task copy. In the GPT-5.6 reference, useful optional anchors are:

- `.loading-curtain`, `.navbar`, `.marquee`, `.product-stage canvas`, and sections `#top`, `#flavour`, `#craft`, `#release`;
- the `选择产品主题` radiogroup and theme radios, the `摇一摇` button with `aria-busy`, and the inspect button with `aria-pressed`;
- `.app[data-theme]`, computed theme variables such as `--color-marquee`, and localStorage key `fizzora-theme`;
- source seams `utils/interactionMachine.ts`, `utils/storage.ts`, `utils/random.ts`, `three/factories/createCan.ts`, `three/factories/labelTexture.ts`, `three/SceneController.ts`, and `three/ResourceTracker.ts`.

Use equivalent selectors or state seams for other implementations. The reference exposes no authoritative browser debug object, so sent events alone are weak evidence: record DOM state, computed styles, canvas pixel/frame deltas, storage, console, requests, and source-derived invariants.

## Structure And Asset Boundary

- Inventory loading curtain, sticky navigation, theme segmented control, infinite marquee, full-screen Hero canvas, shake/inspect controls, three content sections, and footer.
- Verify each navigation action moves the intended section into the viewport; matching link text or an unchanged URL fragment is insufficient.
- Reject external images, models, HDR files, remote textures/data, or SVG hero art when the task requires fully programmatic visuals.
- Confirm geometry/source and rendered detail together: body, top and bottom rims, tab, tab hole, rivet, recessed top and base groove, vertical highlight, condensation, and metallic response.
- Confirm the label texture is dynamically drawn by Canvas and visibly contains brand, version, repeated detail/seam, nutrition-like small copy, and batch text. DOM copy elsewhere does not prove the texture contains it.
- Record label-region pixels and visible batch detail before and after reload. The same theme/seed must reproduce them; switching theme must update them.
- Run the complete interaction flow while collecting console, failed requests, React warnings, and disposal errors.
- Inspect both source references and Network entries. “No image request” is not enough if media is inlined as data URLs or bundled imports.

## Theme And Interaction State

Test classic red, zero-sugar black, and citrus:

- compare page CSS variables or computed colors, text/borders, marquee color, lights/particles, can material, and label pixels;
- reload after selection and verify localStorage restoration;
- inject an invalid persisted theme and require default fallback.

Audit `idle`, `dragging`, `shaking`, and `inspect` as mutually exclusive states:

- drag pauses auto-rotation and release returns through inertia to idle;
- shake enters a bounded busy/cooldown state and returns to idle;
- inspect enlarges and pauses the product; shake must not interrupt it;
- repeated mixed actions must not deadlock and must return to auto-rotation.

Do not infer exclusivity only from disabled buttons. Pair control attributes with visual/canvas motion and, when available, state-machine tests.

## Loading And Scroll Narrative

- Hard-refresh and capture at least two progress values plus the upward reveal within the task limit. A curtain that merely remains in the DOM with `aria-hidden` is not proof of an animated reveal.
- Scroll and verify header visual state, content entrance/highlight, parallax or pinned-product behavior, and marquee motion/color.
- Under `prefers-reduced-motion`, continuous marquee/scrub/large displacement should be reduced while content and state feedback remain available.
- Resize to `360px` and back; require stable canvas/control/section dimensions and no crash or major layout jump.
- Capture bounding boxes before, at `360px`, and after restoration; check horizontal overflow and that the canvas is nonblank after every resize.

## 3D Control Sequence

1. Sample idle canvas frames at separated timestamps to prove slow auto-rotation.
2. Move pointer left/right and verify elastic tilt, then move outside the stage and require a smooth return to neutral.
3. Focus canvas and use arrow keys; verify eased camera/product response.
4. Drag slowly and flick quickly; compare immediate rotation, inertia magnitude, decay, and return to auto-rotation.
5. Click without movement and verify no accidental inspect.
6. Trigger shake; verify can vibration plus increased bubbles, immediate busy/disabled state, no duplicate burst within about `1.2s`, and later recovery.
7. Enter inspect from the dedicated control, switch theme while inspecting, then exit by control and Escape.

A sent pointer event is not a pass. Require transform/camera state delta when exposed, otherwise repeated canvas pixel changes plus control state. Specifically test pointer-leave recovery: a reference implementation can keep the last pointer target and appear interactive while never returning to neutral.

## Tests And Source Evidence

- Run the candidate's declared `build`, `test`, `typecheck`/`lint`, and browser test scripts when present. Report dependency/startup failures separately from assertion failures.
- The reference unit tests in `src/test/{interactionMachine,motion,random,storage,themeCss}.test.ts` cover state transitions, reduced-motion config, deterministic seeds, bad storage, and CSS mapping.
- The reference `e2e/brand.spec.ts` covers theme persistence, shake cooldown, runtime errors, and `360px` overflow, but does not prove drag inertia, pointer return, inspect motion, label pixels, scroll narrative, or resource cleanup. Supply those missing runtime checks.
- As a task-level engineering audit, inspect RAF cancellation, resize-observer/listener removal, tween/ScrollTrigger cancellation, and disposal of renderer, geometry, material, and texture on the actual mounted lifecycle. Equivalent lifecycle code is valid; do not require a particular `ResourceTracker`, renderer-list call, or forced context-loss API. For judge item 1 specifically, the scored boundary is the absence of runtime/dispose-after-access errors during its flow; lack of complete source-level cleanup proof alone must not fail that item.

## Visual And Accessibility Judgment

Judge three themes at desktop and mobile for a consistent premium metal/glass-control visual system with distinct theme personality, readable typography, unclipped 3D product, and no decorative gradient blobs. Measure representative text/background contrast and require WCAG AA where specified.

## High-Risk False Passes

- Theme changes only page background while label, lights, material, and marquee stay stale.
- Shake animation occurs but button remains active and repeated clicks stack timers.
- Drag works but permanently disables auto-rotation.
- Pointer tilt changes but never returns after the pointer leaves the canvas.
- Inspect is triggered by clicking the can instead of a dedicated control.
- The can is a plain cylinder while required top, tab, condensation, and label details are absent.
- A batch number is visible in page text but not in the Canvas label.
- The loading curtain exists but hard-cuts or only toggles hidden state.
- Existing happy-path tests pass while scroll, keyboard, inertia, reduced-motion, or disposal requirements remain untested.

## Rendered Detail Over Source Plausibility

Procedural-asset points name detail that must be visible: pull tab, rivets, chamfered lip, vertical highlights, condensation, plus label wordmark, version copy, fine print, and batch number.

- Judge these from running screenshots and close crops of the can. Geometry constructors and Canvas `fillText` calls do not prove the detail reaches the screen.
- If the can renders too dark or too low-contrast to make out the listed features, or the batch number is unreadable, the corresponding points fail even though the code draws them. Attach the crop showing the deficit.
- Keep the no-external-asset point separate: a clean network panel speaks to provenance, not to visual completeness.

## Scope Discipline

Score each state-machine point on the property the judge actually names.

- The mutual-exclusion and recovery point asks whether interaction returns to auto-rotation, not whether one particular trigger can fire repeatedly. If shake cannot be re-triggered back to back, drive consecutive interactions another way, such as entering and leaving inspect mode, and pass the point when the scene reliably returns to idle auto-rotation.

## Recommended Evidence

- `product-asset-network-audit.json`
- `product-theme-state.json` with computed colors, storage, and label pixel signatures
- `product-interaction-machine.json` with control attributes and motion samples
- `product-motion-samples.json`
- `product-console-resource-audit.json`
- theme, interaction, scroll, and mobile screenshots

## Alignment-Focused Adjudication

Evaluate the ordinary user-visible route before relying on Three.js scene inventory. Capture load, interaction, responsive, and fallback states at stable exposure, then correlate visible objects/material changes with scene state. For animation or customization, use before/during/after frames and a machine-readable state where available. A mesh, light, or handler existing in source is supporting evidence only; it does not establish visibility, usability, or successful completion. Avoid failing an equivalent visual implementation because it uses different object names or camera constants.
