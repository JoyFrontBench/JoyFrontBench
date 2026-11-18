---
name: liquid-pouring-simulator-eval
description: Evaluate deterministic liquid-pouring simulators with gravity-level free surfaces, geometry-based outflow, ballistic streams, viscosity effects, receiver hit/overflow/spill behavior, volume conservation, controls, presets, and RAF lifecycle safety.
---

# Liquid Pouring Simulator Eval Skill

Use this skill for `frontenjoyai-018` and similar browser physics labs.

Treat the task and `criteria` as the contract. Use the GPT-5.6 implementation to locate observable seams, not as a whitelist of valid component or function names.

Default method: run simulation/domain tests, then use Playwright with controlled parameter sequences, rendered geometry/pixels, statistics, and state snapshots. Visual streams support the verdict, but physical relationships must be proven numerically or through importable functions.

## Evidence Anchors

Useful optional anchors from the reference are:

- `倾斜角`, `data-testid="vessel"`, `liquid-surface`, `receiver`, `receiver-liquid`, `stream-path`, `predicted-impact`, `puddle`, and `start`;
- report values `stat-poured`, `stat-caught`, `stat-overflow`, `stat-spill`, `stat-speed`, `stat-error`, and `efficiency`;
- pure seams `simulation/geometry.ts`, `simulation/physics.ts`, `simulation/engine.ts`, `simulation/stats.ts`, `simulation/rafLoop.ts`, and `state/presets.ts`;
- unit tests `src/test/physics.test.ts` and `src/test/engine.test.ts`, plus browser tests `e2e/lab.spec.ts`.

Equivalent selectors and modules are valid. The reference exposes no browser debug state, so capture rendered geometry or pixel/particle samples, report values, control state, console output, and pure-function results. Capture SVG points only when the candidate uses SVG.

## Project And Control Inventory

- Confirm Vite/React/TypeScript structure, build/test/typecheck scripts, and importable geometry/physics/engine/statistics modules.
- Require an actual experiment view, at least four vessels, three liquids, angle and user-adjustable flow-rate controls, draggable receiver, start/pause/resume/reset, slow motion, and report/preset UI.
- Verify each vessel changes geometry/capacity/outlet and each liquid changes viscosity-related parameters, not only labels.
- Verify vessel angle and receiver position update from real pointer/slider interactions.
- A `speedScale` or flow-rate field in state without a reachable UI control does not satisfy the flow control requirement.

## Free Surface And Outflow

Test the same vessel at about `30` and `60` degrees:

- the liquid free surface must remain horizontal in world/screen gravity space;
- the clipped/intersection polygon must change with angle and remaining volume;
- fail a liquid rectangle that rotates with the vessel.

When SVG is used, record the surface endpoints and polygon points. Require `y1 ~= y2` in screen/viewBox coordinates at both angles while polygon intersections differ.

For outflow:

- compare full and nearly empty states at the same angle;
- require a full vessel to pour at a smaller angle and a low-volume vessel to require more tilt;
- hold angle constant while draining and verify flow falls toward zero; increase angle and verify flow resumes;
- inspect source/tests to reject a fixed `angle >= threshold` implementation.

## Stream And Viscosity

- Save sampled outlet position, initial velocity, gravity, trajectory points, predicted impact location, and visible flow shape. For SVG implementations, include polyline/path points and dash pattern when used; Canvas or particle implementations may prove the same behavior through pixel/particle samples.
- Require a ballistic/parabolic relation and continuous landing changes with speed, tilt, and outlet height.
- Reject a fixed Bézier path or `landingX = angle * constant`.
- Under identical vessel/angle/head, compare water, syrup, and honey: water should generally be faster/thinner/farther; viscous liquid slower/thicker/more vertical.
- At very low viscous flow, require deterministic droplets rather than an unbroken line.
- Vary the actual flow-rate control as well as angle. Changing angle alone does not prove that the required rate control affects trajectory.

## Receiver, Splash, And Conservation

1. Align receiver with impact and pour; verify horizontal receiver liquid rises and caught volume increases.
2. Move receiver away; verify miss/spill and growing table puddle.
3. Select a vessel/run whose available volume can exceed receiver capacity, fill the receiver, and continue; verify overflow and additional puddle volume.
4. Reset and repeat identical parameters/slow-motion frames; compare deterministic splash output.
5. At sampled times compute:

`initial volume = remaining + caught + overflow + table spill + allowed numerical error`

Require nonnegative remaining volume, monotonic caught/overflow/spill ledgers, and near-zero error. Do not double-count overflow if the displayed puddle total already includes it.

## Lifecycle And State Controls

- Pause must freeze frame and statistics; resume continues from the same state.
- Reset clears particles, vessel and receiver levels, spills, overflow, puddle, statistics, and run status.
- Rapid start/pause/reset must not stack RAF loops or accelerate simulation.
- Invalid angles, rates, capacities, and time steps must clamp/reject without NaN, negative volume, infinity, or impact jumps.
- Save two real experiment presets and compare efficiency from their measured results, not constants.

## Responsive And Reduced Motion

At `360px`, complete the judge-required vessel/liquid selection, pour, receiver movement, and report review without major overflow. Also verify tilt or flow-rate controls remain reachable when the mobile layout exposes them, but do not add a separate mobile-only flow-control requirement.

Under `prefers-reduced-motion`, require the simulation animation cadence to reduce or become discrete while surface, outflow, hit, and statistics semantics remain correct. CSS transition suppression alone does not satisfy this requirement. Search both source and runtime behavior for media-query handling.

## Tests And Evidence Closure

- Run `build`, `test`, and `typecheck` as required by the judge; report missing native/optional dependencies as environment failures rather than silently treating tests as passed.
- Reference physics tests prove horizontal surfaces, volume-dependent pour thresholds, ballistic parameter sensitivity, viscosity, drip gating, hit detection, and deterministic splash.
- Reference engine tests prove conservation, miss/overflow ledgers, pause, reset, clamping, preset snapshots, deterministic runs, and single RAF start/cleanup.
- Reference E2E proves one hit and one miss flow only. It does not prove all vessels/liquids, a flow-rate UI, dynamic depletion threshold, overflow, duplicate-RAF behavior, preset comparison, reduced-motion, or mobile completion.
- Correlate UI report values with pure-function/state results. A passing unit function that is not wired to the rendered experiment is insufficient.

## High-Risk False Passes

- Liquid color changes with viscosity while trajectory and flow remain identical.
- The stream looks curved but uses a fixed decorative path.
- Receiver fills visually while conservation/report values do not change.
- Reset clears UI labels but leaves RAF, particles, or accumulated puddle state.
- A preset comparison uses current form inputs instead of completed simulation results.
- Physics state contains `speedScale`, but the user cannot change it.
- A CSS reduced-motion rule exists, but the simulation continues at the same RAF cadence.
- Existing E2E hit/miss tests pass while overflow, depletion, presets, and mobile behavior remain unverified.

## Stream Visibility Gates Downstream Points

Trajectory, landing point, viscosity, hit/overflow/splash, and free-surface points all depend on the liquid being observable in the running page, so establish visibility first.

- Start a pour and capture a frame sequence. Confirm the stream and the in-container surface are actually rendered and behave plausibly.
- If the stream is invisible, degenerate, or clearly non-physical, every point depending on observing it fails: parabolic shape, landing response to angle or speed, viscosity differences, receiver hits, overflow, puddles, and splash determinism. Record `水流不可见/不正常` and attach the frames.
- A correct projectile formula, a trajectory sample array, or a volume ledger in the source does not rescue these points. These tasks state `判断依据：看画面 + 读源码 + 测试`; the visual leg is mandatory.
- The same rule covers the free surface: if the liquid cannot be seen after tilting the container, the stays-horizontal point fails instead of passing on the geometry code.
- Score the `360px` responsive point independently. Pass it when the mobile frame renders correctly, even while stream-dependent points fail.

## Recommended Evidence

- `pour-physics-parameter-matrix.json`
- `pour-free-surface-samples.json` with surface/intersection evidence appropriate to SVG, Canvas, or particle rendering
- `pour-trajectory-and-viscosity.json` with trajectory/impact/width samples appropriate to the renderer
- `pour-volume-ledger.json`
- `pour-raf-lifecycle.json`
- aligned/missed/overflow/mobile screenshots and frame sequences

## Alignment-Focused Adjudication

Distinguish visual liquid motion from physically coherent transfer. Sample source volume, target volume, spill amount, vessel pose, stream/contact geometry, and total conserved quantity across the pour. Use close frame sequences for stream onset, collision, fill-level change, overflow, and settling; implementation formulas are corroboration only. Exercise each control and preset through the UI, and verify that reset restores all physical and visual state. Do not infer a pass from a moving shader when volumes or contacts contradict the picture, nor fail a short transient that sparse screenshots simply missed.
