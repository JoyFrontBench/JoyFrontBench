---
name: octopus-drum-svg-eval
description: Evaluate single-file offline SVG octopus-drummer animations with eight connected role-specific arms, a complete realistic drum kit, synchronized stick contact and drum/cymbal vibration, pedal-to-beater/hi-hat causality, SMIL/CSS motion, and coherent live-stage visual quality.
---

# Octopus Drum SVG Eval Skill

Use this skill for `frontenjoyai-029` and similar mechanical SVG character animations.

Default method: open the single HTML offline, audit SVG/CSS/SMIL source, and capture synchronized multi-frame close crops of every striking and pedal mechanism.

The task judge is authoritative. Reference markup below is an evidence map, not a naming contract.

## Stable Evidence Entrypoints

- root SVG such as `#octopus-drum-stage`;
- exactly eight role-bearing groups exposed by `[data-limb]`;
- instrument groups exposed by `[data-instrument]`;
- pedal linkages exposed by `[data-mechanism]`;
- accessible labels that identify each arm target and each drum/cymbal.

For SMIL, pause and seek the root SVG with `pauseAnimations()` and `setCurrentTime(t)` when supported. Read animated geometry through `animVal`, `getBBox()`, CTMs, or rendered screenshots; `getAttribute()` alone often returns only the base value.
## Technical Boundary

- Require one `.html` that plays from `file://` without installation or network.
- Reject external images/SVG/fonts/CSS/JS/CDN/iframe/data-URI bitmaps/API requests.
- Require octopus, drum kit, and core detail from native SVG elements.
- Reject Canvas, WebGL, Three.js, pre-rendered bitmap subjects, and `requestAnimationFrame` or per-frame DOM updates driving core motion.
- Confirm continuous loops use SMIL or CSS keyframes and do not visibly snap at the boundary.

Static-source counts are only a first gate. A reference-compatible structure may contain 8 limbs, 8 instruments, 2 mechanisms, and many `<animate>` nodes, but those counts do not prove contact, vibration, or causality.

## Octopus Anatomy And Arm Roles

- Count one recognizable head/body and exactly eight distinguishable arms.
- For each arm, record root attachment, taper, path, endpoint, animation, and role.
- Require smooth attachment to the body at rest and throughout animation: no gap, floating root, hard right-angle joint, tearing, extreme stretch, or clipping.
- Assign each arm to drumstick striking or pedal operation; both role classes must exist and targets must be unambiguous.
- Reject multiple arms piled onto one target or arms that remain unused for the whole cycle.

Use close crops and sampled SVG geometry; a full-stage screenshot is too small for attachment claims.

At each sampled time, compare every arm path's root neighborhood with the body silhouette and its endpoint/stick/pedal. Require continuity over the whole loop, not merely coincident base coordinates at `t=0`.

## Drum-Kit Inventory And Layout

Require recognizable:

- bass drum with pedal;
- snare;
- floor tom;
- two rack toms;
- hi-hat;
- crash;
- ride;
- visible hi-hat pedal mechanism.

Judge a plausible drummer-view arrangement and foreground/depth order: bass centered forward, toms above, hi-hat at side, cymbals elevated, sensible relative scale. A flat checklist row of drums fails composition.

The eight required instrument roles are bass drum, snare, floor tom, rack tom 1, rack tom 2, hi-hat, crash, and ride. Inventory by role and geometry, not by trusting `data-instrument` text.

## Strike Contact And Vibration Timeline

Sample at least four phases per common cycle, and more around each contact. For a common duration `T`, start with `0`, `.25T`, `.5T`, and `.75T`, then seek each arm's declared key times:

- calculate stick-tip to target-surface distance;
- identify downstroke, contact, and rebound;
- reject permanent gap, off-target impact, or penetration;
- at the contact frame require the corresponding head/cymbal to deform/swing/ripple;
- verify vibration decays quickly and unstruck instruments remain stable;
- compare at least two striking arms and require non-identical rhythm/phase.

Save target id, contact timestamp, minimum distance, vibration transform/amplitude, and unrelated-target stability.

Contact invariant: the minimum stick-tip-to-target-surface distance occurs at the visual downstroke/contact phase, is within a small tolerance without crossing through the surface, and target-local deformation begins at that same time. Equivalent offset, nested, or rate-related timelines are valid; do not require identical source `keyTimes`. A permanently animated target is not synchronized feedback.

## Pedal Causality

- Bass pedal downstroke, beater contact, and recovery must share one time base.
- Hi-hat pedal downstroke must close upper/lower cymbal gap; release reopens it.
- Sample complete cycles and reject a pedal that moves independently of its mechanism or a mechanism that animates without pedal movement.
- Inspect source timing links in addition to screenshots.

For each linkage, compare one complete cycle as tuples `(pedal displacement, driven displacement, contact/gap)`. Bass pedal minimum must coincide with beater contact; hi-hat pedal minimum must coincide with the minimum upper/lower cymbal gap. Verify a shared causal time base or equivalent phase mapping without requiring identical duration, repeat declarations, or key-time arrays.

## Visual Judgment

Model-judge initial and moving frames for one coherent deep-sea/live-stage visual language, an obvious octopus-drummer focal point, consistent lighting/material detail, readable depth, original character design, and no animation-frame collapse.

## Observation Protocol

Strike contact is a motion claim and needs a frame sequence. A single still cannot show whether a stick descends, touches, and rebounds.

- Sample the loop at several phases (for example `t = 0 / 0.25 / 0.5 / 0.75`) with close crops around each stick head and its target surface, using `pauseAnimations()` and `setCurrentTime(t)` when SMIL allows it.
- Judge the descend-contact-rebound cycle across that sequence. When the crops show the head leaving the surface and returning to strike it, the contact point passes.
- Keep contact separate from response: a clean strike cycle can pass while the drum-head vibration, phase alignment, or rhythm-difference points fail on their own evidence.
- If the sequence is too sparse to see the approach, capture more phases before scoring rather than failing the point for insufficient evidence.

## High-Risk False Passes

- Eight paths exist but some are decorative and have no role.
- Stick tips move near drums without actual contact.
- Every drum/cymbal vibrates continuously regardless of impact.
- Pedal and beater/hi-hat happen at unrelated phases.
- Native SVG compliance is used to pass weak anatomy or incomplete kit.
- Tests count `<animate>` elements but do not associate target-local vibration with each stick impact.
- Arm paths animate while static highlight/rim paths detach from them.
- The pedal plate and linkage share key times but the beater never reaches the drum surface or the hi-hat gap never closes.
- `getAttribute()` appears unchanged during SMIL, causing a false failure or false pass unless animated geometry is sampled correctly.

## Recommended Evidence

- `octopus-svg-offline-audit.json`
- `octopus-arm-role-attachment.json`
- `octopus-drum-kit-inventory.json`
- `octopus-strike-contact-timeline.json`
- `octopus-pedal-linkage.json`
- full-stage and mechanism-detail frame sequences
- source timing map from limb -> stick/pedal -> target feedback

## Alignment-Focused Adjudication

Judge limb attachment and percussion from frame sequences at useful zoom, not path endpoints or one static frame. Inspect every arm root through a cycle for a continuous tapered silhouette without gaps, unnatural body overlap, or detached motion. For each stick, identify separated, approach, contact, and rebound phases visually; use geometric distance as supporting evidence, allowing small stylized overlap/tolerance when the rendered action clearly reads as contact rather than demanding exact pixel tangency. Evaluate drum/cymbal response separately at the contact phase and compare struck versus unstruck instruments to establish causality. Do not let missing vibration erase otherwise visible stick travel, or let stick travel prove vibration.
