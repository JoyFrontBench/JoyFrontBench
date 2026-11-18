---
name: svg-poster-generator-eval
description: Evaluate single-file offline parameterized SVG poster generators with complete editable event content, deterministic semantic visuals, genuinely different themes and size reflows, persistent/importable parameters, clean standalone SVG/PNG/JSON export, responsive editing, and finished festival design.
---

# SVG Poster Generator Eval Skill

Use this skill for `frontenjoyai-026` and similar offline vector-design tools.

Default method: open the single HTML offline, inspect inline SVG/source, exercise every theme/size/control, parse downloaded SVG and parameter JSON, inspect PNG dimensions, and capture desktop/mobile previews.

The task judge is authoritative. Reference implementations may supply selectors and evidence hooks, but must not narrow requirements or make a component/function name mandatory.

## Stable Evidence Entrypoints

Prefer semantic controls first, then use these reference-compatible hooks when present:

- preview `#neonHarborPoster` with `data-theme`, `data-size`, `data-seed`, and `data-density`;
- groups `#background`, `#visual`, `#title`, `#event-info`, `#ticket`, `#qr`, `#decorations`, and `#safe-area-grid`;
- text/control hooks `#titleInput`, `[data-key="density"]`, `[data-key="seed"]`, theme/size radio values, `#quickGrid`, and `#quickSafe`;
- export hooks `#downloadSvgBtn`, `#copySvgBtn`, `#downloadPngBtn`, JSON export/import controls such as `#exportJsonBtn` / `#jsonFileInput`, and status `#statusToast`;
- optional debug API shaped like `getState()`, pure `renderPoster(params)`, and validated `importParams(params)`.

Do not fail an otherwise testable submission for lacking these exact names. Discover equivalent semantic selectors and record them.

## Offline And SVG Structure

- Require one directly openable HTML with no backend, build runtime, remote font/image/SVG/texture/model/CDN/API dependency.
- Reject `<image>` or base64 bitmap use for the poster subject.
- Inventory native SVG primitives, gradients, patterns, clip/mask/filter, groups, and transforms.
- Require readable unique groups for background, generated visual, title, event info, ticket, QR, decorations, and safe-area/grid aids.
- Parse all `[id]` values in preview and exported SVG; require uniqueness and every `url(#...)`/ARIA reference to resolve.
- Verify no blocking console error during edits and repeated exports.

## Content And Text Editing

Across every theme and size, inventory the complete `NEON HARBOR 2027` content: English title, Chinese subtitle, date, location, slogan, program list, opening time, ticket information, original mark, main visual, SVG QR placeholder, and entry text.

- Edit title, subtitle, date, location, slogan, and price and verify immediate SVG plus parameter-summary update.
- Switch theme/size and require user text and QR/ticket content to persist.
- Enter deliberately long title/location and require wrapping, font scaling, or explicit overflow feedback.
- Measure text bounds against `viewBox`; do not pass content that exists only outside the canvas.

## Deterministic Generated Visual

Require at least three intentional motifs among harbor wave/sound wave, city grid/buildings, coordinates/routes, glowing pixel nodes, abstract N/H, and day/night rhythm.

- Change density low/medium/high and compare actual element count/complexity.
- Change seed and verify a different but valid layout.
- Restore the complete parameter object and require identical generated geometry and rendered content after normalization that ignores irrelevant dynamic IDs, metadata, or equivalent DOM ordering. Same seed with different density may change geometry counts, but must not change event copy.
- Reject unseeded `Math.random()` for final layout.
- Ensure generated visual never obscures title/date/ticket/QR at density boundaries.

Useful measurable invariants include monotonic visual complexity across density samples, unchanged required text, distinct geometry for different seeds, and equal geometry after restoring the same seed. A changed `data-seed` or summary string alone is not evidence.

## Theme And Size Reflow

Themes must differ in composition, hierarchy, type scale, color, and decoration, not only background:

- Geometric Pulse: large geometric focus and strong division/diagonal hierarchy;
- Swiss Grid: explicit columns/baseline/alignment and restrained palette;
- Night Signal: dark signal/wave/node language with readable small text and controlled glow.

Sizes must expose matching `viewBox` and genuine reflow for A3 Portrait, Social Post, Story, and Landscape Screen:

- A3 print safe area;
- Story top/bottom safety;
- Landscape horizontal information/visual division;
- Social thumbnail title readability.

Where the named specifications are used, verify `3508x4961`, `1080x1350`, `1080x1920`, and `1920x1080` respectively; compare `viewBox` aspect ratio to both preview and PNG dimensions.
Compare element bounding boxes to prove layout rearrangement rather than uniform scaling/cropping.

## State And Export

- Change colors, theme, size, density, seed, grid, and safe-area controls; verify one poster state drives preview and summary.
- Density/seed must not overwrite text.
- Reload a non-default parameter state and require the same poster to return. Export parameter JSON, reset/change state, import that file, and compare title/subtitle/date/place/tagline/price, three colors, theme, size, density, seed, grid, and safe-area flags plus rendered geometry.
- Import malformed JSON and require an error without damaging the current poster. For well-formed objects with invalid or unsupported fields, accept safe rejection, per-field fallback, or bounded clamping when the resulting state remains valid and deterministic; do not require every finite out-of-range seed/density value to throw. Discover the candidate's actual local state key rather than requiring a reference implementation's key.
- When scoring judge item 6 in isolation, keep its two explicit subchecks separate from these task-level persistence/import requirements; judge item 8 independently requires JSON export on mobile.
- Download SVG and copy source from a clearly non-default state; parse and compare `viewBox`, text, colors, seed-dependent geometry, and current theme.
- Open exported SVG independently offline.
- Grid, safe area, control points, and editor UI must be excluded by default. If a preview toggle also opts into exported guides, verify that this is explicit and that only the requested SVG guide group is added.
- Inspect PNG aspect ratio/current scale note and repeat exports to detect stale-state or busy-lock failures.

Intercept downloads and clipboard writes rather than trusting success toasts. For PNG, decode the file and assert exact `round(viewBox width * statedScale)` and `round(viewBox height * statedScale)` dimensions.

## Visual And Mobile Judgment

At desktop and `360px`, complete theme/size/text/seed/density actions plus SVG and parameter-JSON export with no page-level horizontal overflow and an aspect-correct preview.

Model-judge festival identity, title dominance, bilingual hierarchy, restrained theme palette, intentional harbor/sound/city motifs, and finished promotional-material quality. Reject generic gradient blobs, glass cards, centered-title templates, and random decoration.

## Scope Discipline

Attribute each deduction to the defect that is actually present.

- Changing the poster size does not by itself hide key information. Do not use "information is cut off after switching size" as a reason; verify what the preview shows at each size first.
- When an information-completeness point does fail, base the reason on the real cause — long-text wrapping, scaling or overflow handling, the text-editing round trip, or content loss under a specific theme — and name the field and the size where it occurs.
- Layout reflow and `viewBox` proportions belong to a separate task. Keep those observations out of the information-completeness rows.

## High-Risk False Passes

- Three themes are the same layout with color substitutions.
- Four sizes only crop or scale one portrait poster.
- Seed changes a displayed number but not generated geometry.
- Exported SVG contains editor guides or depends on page CSS.
- Long text remains in DOM but is clipped outside the `viewBox`.
- Tests compare only `textContent` across density changes and therefore miss covered, clipped, or stale geometry.
- Theme/size screenshots look different because of preview scaling while exported coordinates remain one reused layout.

## Recommended Evidence

- `poster-svg-structure.json`
- `poster-theme-size-bboxes.json`
- `poster-seed-density-determinism.json`
- `poster-state-import-export.json`
- exported SVG/PNG/JSON
- all theme/size and mobile screenshots

## Alignment-Focused Adjudication

For every size and theme, use the live controls, wait for preview stabilization, and inventory required content by rendered bounding boxes inside the current viewBox. Distinguish responsive re-layout from whole-artwork scaling by comparing relative positions, line breaks, grouping, and safe-area use across aspect ratios. Confirm text/color/seed/density edits in both preview and exported SVG/JSON; control existence or internal state alone is insufficient. On narrow screens, test the entire edit-and-export workflow and document-level overflow, while allowing the preview itself to scale proportionally. Do not infer clipping from a screenshot crop until SVG bounds and viewport scrolling are checked.
