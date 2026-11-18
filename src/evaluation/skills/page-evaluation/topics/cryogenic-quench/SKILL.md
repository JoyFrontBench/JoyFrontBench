---
name: cryogenic-quench-eval
description: Evaluate interactive Three.js cryogenic quench demonstrations with a bright laboratory scene, coupled thermal and motion state, impact and boiling regimes, bubbles, cold fog, synchronized controls, deterministic scrubbing, and responsive evidence.
---

# Cryogenic Quench Eval Skill

Use this skill for `frontenjoyai-012` and similar liquid-nitrogen quench simulations.

Treat the task and `criteria` as the contract. Score only the nine judge rows and their child criteria. Keep task-level implementation, performance, and code-organization findings as supporting evidence; do not turn them into extra scored criteria.

The GPT-5.6 Sol implementations are useful for locating selectors, state seams, and likely failure modes. They are not a whitelist of valid names, architecture, formulas, or stage boundaries.

Default method: Playwright at `1200x800` or `1440x900`, a `360px`-wide follow-up, screenshots and detail crops, console capture, source inspection, and time-series sampling of simulation state, DOM readouts, transforms, particle signatures, and rendered pixels.

## Evidence Anchors

Useful optional anchors seen in completed implementations include:

- `#play`, `#reset`, `#progress`, `#timeline`, `#temp`, `#speed`, `#regime`, `#metalTemp`, `#film`, `#vapor`, `#bubbleRate`, `#level`, `#dataProgress`, `.stage`, and `.viewbtn`;
- `#playBtn`, `#resetBtn`, `#progressRange`, `#timelineRange`, `#tempRange`, `#speedRange`, `.stage-btn`, and `.view-btn`;
- model seams such as `sample(progress)`, `seek(progress)`, `update(dt)`, heat/film/surface/bubble/fog classes, or an exposed debug-state object.

Equivalent selectors and model structures are valid. If no debug state is exposed, correlate source formulas with DOM readouts, object transforms, geometry buffers, instance counts, material values, and screenshots.

## Initial Scene And Inventory

- Load at default `850 C`, wait several seconds, and verify the ball remains clamped and the experiment does not auto-start.
- Require a full-viewport WebGL Canvas, bright clean laboratory, mildly reflective light-gray bench, restrained glow/Bloom, a readable hot-ball boundary, and no dark science-fiction or poster-like presentation.
- Verify a recognizable open double-wall Dewar with inner and outer walls, gap, thick base, rounded rim, and about 70% transparent pale-cyan liquid.
- Inventory start/pause/continue, reset, `0.1x-1.0x` speed, `600-1000 C` initial temperature, progress slider, bottom timeline, five stage controls, four camera presets, Orbit drag/zoom, and all seven required data fields.
- At about `360px`, require the four presets, all required data, both progress controls, and primary actions to remain reachable and readable. A media query that hides `.views`, later data rows, or the whole data panel fails the affected judge criteria rather than passing as a simplified mobile layout.

## Coupled State And Thermal Causality

Locate one coherent state or model containing at least:

- metal temperature, position/velocity, and immersion;
- vapor-film thickness and stability or rupture;
- vapor/bubble generation rate;
- liquid level, time, and progress.

Sample state and rendered outputs during playback. Require:

- temperature to decrease continuously while sphere color, emissive intensity, Bloom contribution, and local light decline consistently toward dark metal;
- entry motion to show gravity before contact and buoyancy/quadratic-drag-like deceleration after immersion;
- film, bubbles, liquid disturbance, level, fog, and panel values to be driven by the same state rather than independent decorative clocks;
- phase changes to depend on temperature difference, film stability, immersion, and hysteresis or an equivalent state transition, not only fixed progress/time thresholds.

Search source for direct stage branches such as `p < constant`. A deterministic `sample(progress)` function is valid and useful for scrub reconstruction, but it does not satisfy the phase-causality criterion when progress alone determines the regime. Temperature may influence duration or intensity, but that is insufficient if the actual transition boundaries stay fixed.

Compare `600 C` and `1000 C` in repeatable runs:

1. sample equivalent physical states and judge-guided equivalent progress points;
2. record transition times, cooling curves, bubble/vapor rates, fog density, and liquid loss;
3. require the hotter run to produce longer strong boiling, higher bubble/vapor rate, denser fog, and slower cooling, not merely a different temperature label, intensity multiplier, or total duration.

## Simulation Clock, Pause, And Determinism

- Pause during active boiling and wait long enough to compare geometry, transforms, instance matrices, particle positions, and pixels after controls settle.
- All physical and visual phases must derive from simulation time. Reject a scene-level `elapsed += dt` or wall-clock animation that keeps liquid waves, film shape, ball rotation, particles, or fog moving while paused.
- Seek to the same progress twice from different prior stages and compare state plus aggregate particle/visual signatures such as count, size distribution, density, and occupied region. Exact particle identities or pixel equality are not required, but previous-stage populations must not remain and the reconstructed macrostate must be repeatable.
- Resume after a seek and verify smooth continuation from the selected state.
- Reset must restore time, clamp and ball position, temperature, particles, film, waves, fog, liquid level, stage, readouts, and both progress controls.

## Release, Impact, And Liquid Surface

Capture a frame sequence from release through submergence:

- clamp opens, the sphere accelerates downward, contacts the surface, then visibly slows and sinks without tunneling or teleporting;
- impact produces a local crater, annular crown, continuous liquid sheet/film, droplets, outward ripples, and a short bright vapor burst;
- disturbance propagates outward and decays instead of switching off globally.

Inspect the liquid geometry or equivalent dynamic surface:

- vertices/normals or another real surface representation must change over time;
- impact, bubble arrivals, nucleate boiling, and cooldown must create distinguishable surface responses;
- droplets follow arcs, return, and create local secondary disturbance;
- liquid level decreases continuously with integrated vaporization and agrees with the panel.

A static plane with normal-map shimmer, a permanently visible torus, or one global agitation scalar does not prove the event-specific responses.

## Film, Bubbles, Fog, And Cooldown

Use side, underwater, and macro views plus multi-frame evidence:

- film boiling shows a continuous uneven translucent shell with moving thickness variations;
- instability develops through local thinning/collapse and migrating rupture, with short vapor jets and small ball impulses/rotation rather than an instant hide;
- film-stage bubbles detach from the sphere's upper region, are larger, sparse, irregular, visibly wobble/expand, and show at least one observable split or merge event;
- nucleate boiling originates from multiple surface sites and produces substantially smaller, denser plumes;
- individual bubble arrivals create local bulge/burst/ripple or fog feedback; global surface noise alone is insufficient;
- cold fog crosses the rim, sinks, spreads along the bench, flows around the Dewar, and thins instead of rising like hot smoke;
- condensation/frost develops without turning the glass opaque;
- cooldown ends with dark metal, sparse bubbles, calmer liquid, lower level, and residual thinning fog.

Correlate bubble count and mean size, film scale/opacity, liquid geometry statistics, fog particle height/radius, and material/light values with the corresponding panel fields.

## Scrub Reconstruction

Exercise both sliders and all five stage controls:

1. observe automatic bidirectional synchronization;
2. scrub forward, backward, to `0%`, `100%`, and several middle points;
3. click each stage control and verify hover, keyboard focus, active feedback, representative state, and immediate pause;
4. compare ball position/velocity/temperature/material, film, bubble population and size, liquid surface/level, fog, time, stage, and both sliders;
5. continue from every selected state.

The primary action must become continue after manual selection. `0%` must reconstruct the clamped pre-release scene; `100%` must show cooled metal, reduced level, and residual fog. Changing labels/readouts while the Canvas remains materially unchanged is a failure.

## Camera And Layout

- From the same starting progress, compare `0.1x` and `1.0x` over equal wall-clock intervals. The faster setting must advance proportionally farther, while seeking both runs to the same progress must reconstruct the same physical state mapping.
- Click all four presets and record materially different camera poses serving wide, side, underwater, and macro inspection.
- Drag and wheel-zoom after a preset change; Orbit interaction must remain available and must not reset simulation state.
- Check that panels and timeline do not cover the Dewar rim, sphere, primary action, or progress controls at desktop and narrow widths.
- Do not infer a working preset from an active CSS class alone; sample camera position/target or rendered composition.

## Task-Level Technical Evidence

Record separately from judge scoring:

- single-HTML delivery and allowed Three.js/module loading;
- ACES Filmic tone mapping and the other explicit rendering/material choices from the task;
- readable model/system organization and pooled or instanced particles;
- resize/reset lifecycle and absence of blocking console, resource, or disposed-object errors;
- fixed-light reuse and reasonable runtime behavior.

Do not create additional score rows for these checks when they are not present in `criteria`.

## Reference-Test Limits

The completed OpenCode browser tests prove basic slider synchronization, stage navigation, resume behavior, one view button, temperature input, and mobile visibility of the primary controls. They do not prove thermal causality, impact physics, dynamic liquid geometry, bubble morphology, local surface feedback, pause freezing, deterministic reconstruction, fog direction, all mobile data, or camera correctness.

## Observable Morphology Gate

Bubbles, fog, condensation, and surface behaviour are scored from the stage frames, never from object sampling alone. Particle counts, velocity samples, and populated internal arrays do not prove an observable phenomenon.

- Capture the named stages as close crops around the sphere, the liquid surface, and the Dewar rim.
- Bubbles must be individually identifiable in those crops before scoring size, density, or plume points. If none is discernible across the stage frames, the bubble-morphology points fail regardless of state sampling.
- Ground-hugging fog must be visible outside the rim, spreading down and across the bench. A downward velocity sample without visible fog is not a pass.
- Condensation or frost must be visible on the outer wall while the interior stays see-through.

Related runtime-observability rules for this scene:

- Any required camera preset that renders an all-black or otherwise unobservable frame fails the points depending on that view. Report the preset name and attach the frame.
- Temperature-driven appearance must be continuous. A hard cut such as orange-yellow jumping straight to dark with no intermediate frames fails the continuity point.
- A fixture that leaves the sphere visually floating or unsupported fails the initial-state point even when the sphere sits at the correct height.
- Black bars or overlays obscuring the core scene fail the affected visual point.

## High-Risk False Passes

- Stage labels change while phase transitions are fixed progress buckets.
- `600 C` and `1000 C` alter only labels, multipliers, or total duration.
- Panel numbers change while Canvas geometry/materials remain stale.
- Pause freezes progress but a separate elapsed clock keeps the scene moving.
- Scrubbing rebuilds readouts but retains old particles or produces a different result each time.
- Mobile CSS hides required views or data.
- Bubble count changes without size/regime transition, split/merge morphology, or local surface response.
- Fog is a white upward plume or liquid motion is only a shader shimmer.

## Recommended Evidence

- `quench-controls-responsive.json`
- `quench-state-timeseries.json`
- `quench-temperature-comparison.json`
- `quench-pause-and-clock.json`
- `quench-impact-surface-events.json`
- `quench-bubble-film-fog.json`
- `quench-scrub-reconstruction.json`
- full-scene and Dewar/sphere frame sequences

## Alignment-Focused Adjudication

Use staged, multi-view evidence rather than implementation declarations. Inspect every camera preset in the live simulation and reject a view as observationally useful only after waiting for exposure/render stabilization and attempting the provided orbit/zoom controls. For continuous variables, sample temperature and corresponding rendered color/emission, motion, liquid height field, bubbles, fog, and frost over time; source mappings support but do not replace visible continuity. Evaluate fixtures and contacts for physical plausibility in the rendered frame—apparent suspension, black/empty views, or disconnected supports are material evidence even when DOM state is correct. For fast events such as impact, deformation, and splash, record at a cadence appropriate to the event and avoid interpreting sparse frames as proof of instantaneous motion.
