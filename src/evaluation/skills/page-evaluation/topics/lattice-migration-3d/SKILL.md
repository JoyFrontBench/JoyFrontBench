---
name: lattice-migration-3d-eval
description: Evaluate Three.js lattice migration workbenches with deterministic sites and adjacency, real clipping slices, raycast picking, local coordination highlights, validated custom paths, environment-derived energy barriers, chart/3D linkage, animation, persistence, and resource disposal.
---

# Lattice Migration 3D Eval Skill

Use this skill for `frontenjoyai-019` and similar scientific lattice/migration visualizers.

Treat task and `criteria` requirements as authoritative. Reference selectors and module names are optional evidence aids, not required implementation choices.

Default method: domain tests plus Playwright/WebGL pixel checks, screenshots, DOM chart data, persistence inspection, and source lifecycle review. Keep full-scene screenshots and close crops of selected sites, slice planes, paths, and energy charts.

## Evidence Anchors

The GPT-5.6 reference offers these optional stable probes:

- `data-testid="lattice-canvas"`, `slice-controls`, `slice-slider`, `build-path`, and `energy-chart`;
- buttons `完整晶格`, `切片剖面`, axis controls, layer toggles, `重置视角`, `A / B 对比`, and animation buttons with accessible names;
- chart circles with `data-site-id`, chart `data-hovered-node`, and path groups with `data-path`;
- persisted lattice settings, using the localStorage key discovered from the candidate;
- pure modules `domain/lattice.ts`, `domain/energy.ts`, `domain/animation.ts`, `three/resources.ts`, and the Three.js controller.

Use equivalents for other implementations. The reference has no browser debug state for camera, ray hits, scene objects, or path arrays, so DOM attributes alone must be paired with WebGL pixel changes and source/domain evidence.

## Structure And Dataset Audit

- Confirm Vite/React/TypeScript/Three.js project structure and importable lattice, adjacency, slice, path, energy, and animation modules.
- Require a nonblank 3D scene with at least 80 sites, at least three element classes, and clear element color/size legend.
- Verify dopants and vacancies have independent markings.
- Exercise orbit, pan, zoom, reset view, and independent visibility toggles for cell/bonds/vacancies/dopants/paths.
- Check generated sites and configurations are deterministic for the same seed.
- Verify every declared layer toggle changes scene pixels/object counts independently. A checked control with no rendered layer is not a pass.

## True Slice Verification

The task requires clipping, not only filtering atoms.

- Enter X, Y, and Z slice modes and move the plane continuously.
- Inspect renderer/material clipping configuration or equivalent geometry.
- Require cell boundary and bonds to be visibly cut at the plane.
- Compare underlying site/bond arrays before, during, and after slicing; they must remain unchanged.
- Exit slice and prove the complete structure returns.

Inspect renderer clipping enablement and clipping planes on atom, bond, and cell materials or an equivalent geometric clipping path. An array filter can support view culling but does not satisfy a real cross-section when bonds/cell are not clipped.

## Picking And Local Environment

- Find overlapping front/back atoms and click the shared screen region.
- Verify raycast selects the nearest visible hit.
- Compare selected element, coordinates, explicit neighbor list, coordination/local environment, and path membership with domain calculations. A neighbor count alone does not satisfy a required neighbor list.
- Require 3D highlighting of adjacent bonds and a coordination polyhedron, not only an information panel.
- Save camera, ray, hit-distance order, selected id, and derived neighbors.
- If no debug adapter exposes ray intersections, establish expected front/back order from camera/source projection and confirm selection through the inspector plus a selected-site pixel crop.

## Custom Path And Energy

1. Enter path-build mode.
2. Select known adjacent site ids derived from the lattice/adjacency model and verify real-time path extension.
3. Attempt a distant non-neighbor jump and require rejection plus feedback with no path mutation.
4. Complete a path and verify an energy profile appears.

Audit energy as a deterministic function of local environment, such as distance to vacancy/dopant and coordination:

- same seed/config/path -> same profile;
- changed configuration or path -> changed profile;
- no hard-coded constant arrays;
- hover chart step highlights the matching 3D node and hovering the 3D node highlights the chart;
- compare two paths with overlaid curves and bottleneck/mean metrics plus dual 3D highlighting.

Random clicks near canvas center are not proof of path construction. Record accepted site-id sequence, rejected id/reason, path length before/after rejection, and the resulting profile.

## Animation, Persistence, And Cleanup

- Play/pause/resume/reset migration and verify progress/state.
- Rapidly switch configuration, slice, and path while monitoring console and frame rate.
- Inspect RAF cleanup and `geometry/material/texture.dispose`; ensure each resource is disposed once and no orphan object remains.
- On configuration switch, clear or explain selected atoms/path nodes that no longer exist.
- Reload and verify configuration, view mode, slice axis/position, and path visibility/preferences.
- Inject malformed seed/storage and disable WebGL to verify explicit fallback rather than white screen.
- For animation, sample progress and moving-ion pixels: pause must hold both, resume must continue from the held value, and reset must return to the first node.
- A unit test that disposes one mocked object once does not prove scene rebuild/unmount cleanup. Inspect actual dynamic-root rebuild and component teardown paths.

## Responsive And Visual Judgment

At desktop and `360px`, require a usable scientific workbench, visible main scene, simplified but reachable controls, picking/slicing/energy access, and reduced-motion behavior that preserves selection and linkage.

## Tests And Evidence Closure

- The reference `src/test/domain.test.ts` covers 100 deterministic sites, substitutions, reciprocal neighbors, non-mutating slice filtering, adjacent/illegal path steps, environment-derived energy, profile comparison, invalidation, persistence, animation math, malformed seeds, and a generic disposal helper.
- The reference `e2e/workbench.spec.ts` checks a visible canvas, a movable slice slider, resize, chart visibility, and chart-hover DOM state.
- Those tests do not prove visible bond/cell clipping, nearest-front picking, explicit neighbor list, coordination polyhedron, deterministic accepted/rejected custom path, reverse 3D-to-chart hover, moving-ion pause/resume/reset, actual scene disposal, WebGL fallback, or `360px`. Add direct checks.
- Run declared build/test/typecheck/lint/e2e scripts when dependencies are healthy and separate startup failures from behavioral failures.

## High-Risk False Passes

- “Slice” only hides atom centers while bonds and cell remain whole.
- Picking returns a hidden/back atom due to id lookup instead of nearest ray hit.
- Any two selected sites can be connected.
- Energy curve is hard-coded and unchanged by configuration.
- Chart and 3D both have hover effects but do not reference the same path step.
- Inspector shows only neighbor count when the judge requires the neighbor list.
- Chart `data-hovered-node` changes, but no matching 3D node pixel/material changes.
- A generic disposal utility test passes while scene rebuilds leak materials, textures, listeners, controls, or RAFs.
- Existing E2E clicks arbitrary canvas positions and sees a chart, without proving a valid custom path or illegal-jump rejection.

## Recommended Evidence

- `lattice-dataset-adjacency.json`
- `lattice-slice-integrity.json` with data snapshots and scene pixel deltas
- `lattice-raycast-selection.json` with hit ordering and inspector values
- `lattice-path-validation.json` with accepted/rejected site sequences
- `lattice-energy-linkage.json`
- `lattice-resource-lifecycle.json`
- full and detail screenshots

## Alignment-Focused Adjudication

Correlate 3D observations with domain state using the same lattice site and migration step. Verify neighbor eligibility, selected path, vacancy/ion positions, energy profile, slice/rotation view, and persisted state before and after actions. Source algorithms or tests may prove deterministic calculations, but interactive criteria additionally require the user-visible workbench to expose and update the result. For visibility judgments, use orbit/zoom and an unobstructed angle before declaring a structure absent; for correctness, prefer exact site/path/state assertions over appearance alone.
