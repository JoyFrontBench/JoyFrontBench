---
name: engine-simulator-eval
description: Evaluate frontenjoyai-024 Vite/React/TypeScript inline-four engine simulators with importable crank-slider geometry, volume-pressure coupling, closed P-V work loops, ignition timing, continuous valve lift/overlap, 1-3-4-2 firing order, deterministic controls, preset metrics, RAF safety, responsive engineering visuals, and required tests/docs.
---

# Engine Simulator Eval Skill

Use this skill for `frontenjoyai-024` and similar mechanical/thermodynamic teaching simulators.

The task judge is normative. Sample the simulator at fixed crank angles, run importable domain logic, and inspect rendered cutaway/chart linkage. Reference selectors and function names are optional anchors, not an implementation template.

## Preflight And Evidence Anchors

Run declared scripts for `dev`, `build`, `test`, and `typecheck`; run `lint` when present. Record exact exits. Confirm a multi-file Vite + React + TypeScript project with importable domain/simulation modules and no string-template page or `dangerouslySetInnerHTML` shortcut.

Prefer semantic locators. Reference anchors, when available:

- controls: buttons `Play`/`Pause`, `Step +5°`, `Reset`, and time-multiplier select;
- live values: `angle-readout`, `compression-ratio`, `live-max-pressure`, `live-peak-angle`;
- geometry inputs: `input-rpm`, `input-crankRadius`, `input-rodLength`, `input-clearance`, `input-ignitionAdvance`;
- linked graphics: `piston` with displacement data, `valve-marker`, `pressure-marker`, `pv-marker`;
- images: labels matching engine cutaway, valve-lift curve, pressure curve, P-V diagram, and four-cylinder crank end view;
- preset table: named performance rows and optional ids such as `max-pressure-*`, `comparison-ratio-*`, `peak-angle-*`.

Candidate source anchors include `clampConfig`, `pistonDisplacement`, `phaseAt`, `valveState`, `cylinderVolume`, `compressionRatio`, `cylinderPressure`, `generateCycle`, `indicatedWork`, `presetMetrics`, `advanceTick`, `stepAngle`, `allCylinderStates`, `CYLINDER_PHASE_OFFSETS`, `FIRING_ORDER`, and the mounted RAF lifecycle.

Save rows containing global/focused angle, mechanical angle, cylinder, phase, displacement, valve lifts, overlap, volume, pressure, firing, and rendered marker values.

## Geometry And Four-Stroke Cycle

1. Reset, then Step through `0-720°` at fixed increments; include `0/180/360/540/720` and intermediate angles.
2. Independently recompute crank-slider displacement:

```text
x = r + l - (r cos(theta) + sqrt(l^2 - r^2 sin^2(theta)))
```

Require continuous TDC-to-BDC motion and a real rod-length effect; reject keyframes or a plain sine that ignores `l`.

- Verify phase boundaries intake, compression, power, exhaust and matching angle/RPM/displacement/pressure readouts.
- Spark/firing state appears only in the intended ignition/power interval and is tied to cylinder pressure/angle.
- Compare rendered piston displacement data and cutaway geometry with domain output at each sample.

## Volume, Pressure, And P-V

- Recompute volume from effective clearance plus bore area times piston displacement. It must vary with angle.
- During compression, lower volume must produce higher pressure. Inspect formulas and perturb volume/geometry to reject a detached fixed Gaussian.
- Generate one complete cycle including an explicit closing sample. First/last volume and pressure match within tolerance; integrate `sum(p_avg * deltaV)` and require meaningful indicated work.
- Change crank radius and clearance in both directions. Compression ratio, peak pressure, stroke, work, and P-V geometry must respond consistently.
- Change ignition advance while holding geometry fixed. Peak-pressure angle moves earlier/later in the expected direction and UI markers/metrics follow.
- Confirm the rendered P-V x-axis is volume, not crank angle, and the marker uses the same current `(volume, pressure)`.

## Valve Lift And Four-Cylinder Timing

- Sample intake/exhaust lift densely. Values must be continuous, include intermediate lift, and not collapse to binary open/closed.
- Verify intake and exhaust timing around their strokes and simultaneous nonzero overlap near the cycle-boundary TDC.
- At each selected angle, compare domain lift, cutaway valve displacement, chart marker angle, and marker y-values.
- Verify four cylinder states derive from one global crank, with the specified 180-degree firing cadence/opposing mechanical pairs and firing order `1-3-4-2`.
- Compare main cutaway focus, all phase chips, and end-view throw angles at the same global angle. Four decorative cylinders sharing one phase fail.

## Controls, Determinism, And Safety

- Exercise Play/Pause, slow motion, fixed Step, and Reset.
- Record a Step sequence, Reset, and repeat. Full state rows must match independent of wall-clock/frame rate.
- Verify valve, pressure, P-V, end-view, telemetry, and cutaway markers all expose the same focused cycle angle.
- Inject NaN, out-of-range geometry, and `rodLength <= crankRadius` through domain/config APIs or controlled input. Require clamp/rejection plus visible feedback, preserve `rodLength > crankRadius`, and produce no NaN/invalid SVG geometry.
- Rapidly toggle Play/Pause/Reset and count scheduled/cancelled RAF callbacks or compare angular velocity. Exactly one mounted loop may run.
- Verify the actual hook/component uses the protected RAF lifecycle. Passing a standalone `createRafLoop` unit test while another unguarded loop drives the UI is not enough.
- Reset must synchronize angle, piston, valve lifts, charts, pressure, firing, and all cylinder phases.
- Save two presets after real parameter changes. Recompute and compare max pressure, stroke, compression ratio, peak angle, and indicated work; reject copied labels or stale metrics.

## Responsive, Motion, Visuals, And Coverage

- At desktop and `360px`, operate RPM/geometry/ignition, Step, and Reset; keep cutaway, valve lift, pressure/P-V, crank view, and state readable without horizontal overflow or overlap.
- Emulate reduced motion. Continuous decorative/mechanical animation must reduce as designed, while fixed Step still exposes the complete four-stroke and valve sequence.
- Judge a readable blueprint/technical-manual cutaway: clear components, dimensions, labels, phase colors, and charts, not a generic dashboard.
- Count at least 12 Vitest tests and 2 Playwright tests. Verify coverage includes crank-slider geometry, volume-pressure coupling, closed P-V/work, valve overlap, cylinder phase/firing order, ignition peak shift, deterministic step/reset, invalid config, and RAF lifecycle.
- Read README and require run/build/test instructions, modules/data model, mechanical and thermodynamic approximations, reset/seed behavior, and known limitations.

## Reject These False Passes

- Piston is animated independently of domain geometry or rod length.
- Pressure/P-V looks plausible but geometry changes do not alter the cycle.
- P-V is open, is actually pressure-angle, or work is a hard-coded number.
- Valve chart is continuous while cutaway valves use binary state or a different angle.
- Four cylinders/throws are decorative and disagree with domain phases.
- Step is fixed but Play stacks RAF callbacks after rapid toggles.
- Preset cards freeze values at save time without deriving them from the same simulation.
- Reduced-motion CSS only disables a spark animation while continuous motion remains unchanged.

## Named Controls Must Exist And Respond

Several points name a specific adjustment: crank radius, clearance, rod length, ignition advance, and Reset. These are scored on the running page.

- Enumerate every control the judge names, locate it in the mounted UI, and record its selector and value range.
- Drive each one and assert a downstream delta in the coupled views: compression ratio, peak pressure, P-V loop shape, peak crank angle, or the synchronized cutaway/lift/pressure/end views.
- A control that is absent, disabled, read-only, or produces no state change fails its point. If the geometry cannot be changed, the geometry-to-pressure coupling cannot be demonstrated.
- These tasks state `判断依据：交互观察 + 读源码 + 测试`; the interaction leg is mandatory, so a plausible formula in the source never carries the point alone.
- List missing controls by name in the report so the gap is auditable.

## Required Evidence

- `engine-script-results.json`
- `engine-angle-state-table.json`
- `engine-geometry-pressure-matrix.json`
- `engine-pv-work.json`
- `engine-valve-cylinder-timing.json`
- `engine-controls-raf-presets.json`
- desktop, `360px`, reduced-motion, cutaway, charts, end-view, and preset screenshots

Report test counts and failures explicitly. Source formulas, rendered linkage, and interactive parameter effects must all agree for a full pass.

## Alignment-Focused Adjudication

Judge mechanical and thermodynamic behavior from synchronized angle-state tables and rendered frames. Sample crank angle, piston positions, valve lift, stroke labels, pressure/volume, and animation at representative cycle angles; account for the implementation's coordinate convention before claiming inversion. Exercise speed, pause, scrubbing, presets, and camera controls through the UI and verify state continuity. Source equations and unit tests support numerical correctness, while visual criteria require the linkage, timing, and charts to remain observable and mutually consistent.
