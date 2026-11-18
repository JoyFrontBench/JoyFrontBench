---
name: blood-circulation-svg-eval
description: Evaluate single-file offline SVG human blood-circulation diagrams with anatomical structure, semantic SVG groups, continuous pulmonary/systemic flow, cardiac-cycle timing, valves, particles, and responsive medical-illustration quality.
---

# Blood Circulation SVG Eval Skill

Use this skill for current `frontenjoyai-005` and similar animated medical SVG diagrams. The older pelican topic remains separate for historical compatibility.

Default method: open the directly runnable HTML with the network blocked, audit inline SVG/source, capture desktop/mobile screenshots, and sample complete cardiac cycles. The judge requirements are authoritative; reference IDs below are optional stable hooks, not mandatory naming beyond the required semantic meaning.

## Target And Offline Audit

- Require exactly one runnable delivery HTML containing all runtime visual code and assets; non-delivery source/test files do not excuse a second required runtime artifact. It must open without a build or network.
- Reject Canvas, WebGL, external images/GIF/video/fonts/scripts/libraries/icon packs, and runtime resource requests. Confirm the subject is inline native SVG with a proportional `viewBox` or an equivalent responsive SVG scaling scheme.
- Check every SVG `id` is unique and inventory semantic groups/classes for chambers, valves, vessels, organs, body, particles, legends, and labels.
- Confirm reasonable use of the task-required SVG engineering features: paths, gradients, mask or clipPath, filter, marker, and reusable `symbol`/`use` or equivalent programmatic generation. Programmatic particle generation (e.g. a `Particle` class with `createElementNS`) fully satisfies the "reuse" requirement — do not fail a point merely because `symbol`/`use`, `mask`, or `clipPath` were not used when an equivalent programmatic path is present.
- Repeated arrows/particles must use `symbol`/`use` or programmatic generation, not hand-authored frame dumps.
- Reload without input; verify automatic ongoing motion, no blocking console error, and no business-resource requests.

Reference candidates include `#circulation-diagram`, `#heart .heart-chamber`, `#left-atrium`, `#right-atrium`, `#left-ventricle`, `#right-ventricle`, valve IDs ending in `-valve`, `#particle-layer .blood-particle`, and major-vessel IDs. A reference implementation also exposes `data-phase`, `#phase-title`, `#phase-time`, `#av-state`, `#outflow-state`, and `#flow-state`; use equivalent observables when available.

## Anatomy And Connected Network

- Verify the front-facing body includes and labels heart, left/right lungs, head, liver, left/right kidneys, and lower limbs. Generic upper-body/torso tissue only needs to be present in the frame; do not require a separate text label for it — the task only asks that the picture include the upper body.
- Remember anatomical left is the viewer's right. Check liver and cardiac apex placement explicitly.
- Use screenshots plus SVG bounding boxes/clip geometry to detect organs or vessels outside the body, clipping, label collision, or implausible overlap. Bounding boxes alone cannot prove containment for irregular outlines.
- Require separate semantic SVG groups for right/left atria and ventricles, not merely four addressable paths inside one uniformly transformed heart. Require independently controllable tricuspid, pulmonary, mitral, and aortic valves at correct connections.
- Inventory and verify Chinese labels for aorta/arch, superior/inferior vena cava, left/right pulmonary arteries and veins, and arterial/venous branches to head, liver, kidneys, and legs.
- Trace pulmonary and systemic loops using path geometry, endpoints, draw order, and visible screenshots. Nearby endpoints or moving decorative dots alone do not prove a connected network.
- Locate at least three branch/merge/crossing sites and verify foreground/background treatment prevents false connections.

## Flow And Cardiac-Cycle Checks

Sample at roughly `30-60 ms` for at least one full cycle plus the next phase transition. Determine cycle length from task/source; valid task scales are about `0.8`, `1.6`, or `2.4` seconds. Save:

- phase/time observable, chamber transform or path geometry, and four individual valve states;
- representative particle positions, visibility, direction, and color on pulmonary/systemic paths;
- capillary color transition and current flow description when exposed.

Require:

- filling, atrial contraction, isovolumetric contraction, ventricular ejection, and ventricular relaxation/reset in order, with timing proportions consistent with the task;
- pulmonary flow: right ventricle -> pulmonary valve -> pulmonary artery -> lungs -> pulmonary veins -> left atrium;
- systemic flow: left ventricle -> aortic valve -> aorta -> body -> venae cavae -> right atrium;
- pulmonary artery is deoxygenated and pulmonary vein oxygenated;
- color conversion occurs in capillary regions;
- atria contract before ventricles, with left/right counterparts approximately synchronized;
- contraction is chamber-boundary deformation, not only uniform whole-heart scaling;
- valve states match filling, atrial systole, isovolumetric contraction, ejection, and relaxation, including all-closed isovolumetric contraction;
- particles do not cross a closed valve or visibly reverse.

Do not pass from phase labels, CSS keyframe names, or one moving particle alone. Align source timing with live phase, chamber, valve, and particle samples on the same cycle clock.

## Visual And Responsive Judgment

Capture `1440x900` and `390x844`. Judge:

- all organs, labels, vessels, title, legends, and circulation explanations remain visible;
- the exact title `人体血液循环动态示意图`, oxygenated/deoxygenated legends, flow-direction legend, and pulmonary/systemic circulation explanations are present;
- oxygenated/deoxygenated gradients and particle highlights are legible;
- the page reads as a medical education illustration, not a diagram of disconnected colored tubes;
- no horizontal overflow, clipping, or label collision during animation, not only on the first frame.

## Scope Discipline

The judge text is the only source of required conditions. Do not fail a point for a criterion it never states.

- Repeated particles or arrows may be reused through `symbol`/`use` **or programmatic generation**; the judge names both. A `Particle` class with `createElementNS` satisfies the reuse requirement, so do not demand `mask`, `clipPath`, `symbol`, or `use`.
- The judge asks the frame to *contain* the upper body. It does not ask for separate text labels on it. Score this point on anatomical structure, organ distribution, orientation, and containment within the body outline.
- Continuous-circuit proof is about flow direction and connectivity, not about tracing one individual particle end to end. Correct pulmonary/systemic direction plus clear front-back relationships at crossings is sufficient.
- Score the responsive point only against the stated conditions: subject fully in frame, no critical clipping, no label overlap, no horizontal scrolling. Do not add a minimum font size, and do not fail it merely because the illustration scales down and reads smaller at `390x844`.

## High-Risk False Passes

- Four chamber labels exist but all chambers are one uniformly scaled group.
- Valve elements exist but never exhibit independent open/closed states.
- Particles move along isolated decorative paths that do not form a continuous circuit.
- A changing phase panel is mistaken for synchronized five-stage physiology.
- Red/blue colors look plausible while pulmonary artery and vein are reversed.
- A responsive `viewBox` exists while labels or side panels are clipped on mobile.

## Recommended Evidence

- `circulation-target-and-offline-audit.json`
- `circulation-anatomy-bboxes.json`
- `circulation-network-trace.json`
- `circulation-cycle-samples.json`
- desktop/mobile full screenshots and heart/vessel detail crops

## Alignment-Focused Adjudication

Anatomy and vessel-network judgments must be made on rendered geometry, not semantic IDs, labels, or proximity alone. At a readable zoom, trace organ silhouettes against the body boundary, check observer-side versus anatomical-side placement, and follow each vessel centerline through its actual junction with the intended organ or chamber; a line ending near an organ is not a connection. Use overview and detail crops to inspect overlaps, detached endpoints, clipping, and label collisions. For circulation direction, a representative particle need not be tracked end-to-end when repeated arrows/particles visibly establish direction, but every required segment and transition must still be observable. Apply only labels expressly required by the criterion; do not invent a requirement to label every visible body region.
