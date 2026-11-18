---
name: traffic-curve-eval
description: Evaluate traffic curve editor pages that import CSV files, normalize 10-minute time series, edit flow/cumulative curves, and export JSON. Use for "流量曲线编辑工具", file upload/download, 144-point padding, missing time-point zero fill, curve switch, drag/edit linkage, batch edit, and JSON export checks.
---

# Traffic Curve Eval Skill

Use this skill for the "流量曲线编辑工具" class of tasks: CSV upload, 10-minute flow curves, cumulative ratio curves, drag editing, batch editing, filters, and date-scoped JSON export.

Default browser method: Playwright isolated Chrome. Do not use the user's Chrome plugin unless explicitly requested. Capture screenshots by default: initial page, after upload, after filter changes, after curve switch, before/after drag, before/after batch edit, and export-triggering state.

## Required Inputs

- Page URL.
- CSV fixture passed through `--fixture-csv`; use
  `fixtures/traffic_curve_sample.csv` when the repository fixture is available.
- Acceptance criteria. If only "文件上传与下载" is given, include upload, page-state change, export control, downloaded JSON parse, metadata, arrays, and rounding.

If the URL opens a different product page, report link/page mismatch as a hard fail. Do not invent a hidden upload path.

## Strong Automated Checks

- `input[type=file]` exists or upload UI is reachable.
- CSV upload changes visible state: filters, cards, charts, date sections, or local app state.
- Channel and strategy selectors are generated from imported data and do not include "全部".
- User-layer selector includes "全部" and affects visible curves/export scope.
- Each exported `flow_values[layer]` array has length `144`.
- Each exported `cumulative_ratio[layer]` array has length `144`.
- Time axis represents `00:00` to `23:50` at 10-minute intervals.
- Missing CSV time points are exported as `0`.
- Export JSON contains `metadata`, `flow_values`, and `cumulative_ratio`.
- Values are numbers rounded to two-decimal **numeric precision**. Judge rounding by numeric value, not by text form: a JSON `number` that drops trailing zeros (`1.5` serialized instead of `1.50`) still satisfies "two decimals" when the value matches the correct CSV to within two-decimal precision. Do not fail on trailing-zero serialization.

## Drag/Curve Checks

Treat canvas/SVG drag as coordinate-sensitive.

Reliable strategy:

1. Use a fixed viewport.
2. Locate the chart bounding box.
3. Capture screenshot before drag.
4. Send pointer drag at calculated chart coordinates.
5. Capture screenshot after drag.
6. Export JSON or read app state and assert edited values changed.
7. Switch curve type and verify the linked curve changes through derived JSON/state.

Do not pass drag behavior only because pointer events were sent. A pass needs exported/state data change or a visible chart change with screenshots.

For the "可以成功拽动曲线，拽动后另一个曲线也对应变换" criterion, split and test every detailed item independently. Do not collapse the five drag subrequirements into one row:

1. **Both curve types draggable upward and downward**: run four independent drags: flow upward, flow downward, cumulative-ratio upward, cumulative-ratio downward. Pass only when exported JSON proves a sustained target-neighborhood change in the expected direction: flow-up has a nearby `flow_values` increase, flow-down has a nearby `flow_values` decrease, ratio-up has a nearby `cumulative_ratio` increase, and ratio-down has a nearby `cumulative_ratio` decrease. A tiny side-effect elsewhere in the array is not enough. If screenshots/recording show snapback, cite that as visual evidence. If visual snapback is not directly observed but the exported target-neighborhood delta is only the minimum rounding unit, say the automation cannot prove free dragging in that direction and mark it `fail`.
2. **Cross-curve linkage**: after flow drag, verify `cumulative_ratio` changes; after cumulative-ratio drag, verify `flow_values` changes.
3. **Y-axis expansion**: drag a high flow point slightly above the chart plot boundary, capture the drag frames, and export after release. Treat the data update as objective evidence; judge "顺滑" with the model from video/frame evidence first. Use `fail` only when the frames are too sparse or the expansion is not visible.
4. **Single vs same-day linked scope**: with user layer set to "全部", run a single-curve precise drag and assert only one exported layer changes. Then switch to "同日人群联动", run the same precise drag, and assert all currently exported/displayed layers for that date change. If the radio is selected but only one layer changes, mark this subitem `fail`.
5. **Precise vs fuzzy precision**: run precise drag and assert one time index changes. Then switch to "模糊模式", run a drag, and assert multiple neighboring time indices change. If fuzzy mode changes only one time index, mark this subitem `fail`.

Always save a machine-readable drag summary containing selected radio labels, target index, exported layer count, changed layer names, changed indices, and before/after download paths. The Markdown report should reference both the screenshots and this summary JSON.

For drag evidence screenshots, prefer cropped chart/card screenshots over full-page screenshots. In criterion rows, avoid listing duplicated frames such as `mouse-up` and `after-drag` when their image content is identical. Use outcome screenshots plus machine-readable summaries for the main evidence; keep the full frame sequence in the screenshot archive for traceability.

For drag criteria, keep evidence scoped to each criterion:

- draggability: before/after screenshots plus the drag summary
- cross-curve linkage: before/after exported JSON plus the drag summary
- y-axis expansion: visible drag-frame screenshots plus the drag summary
- single vs linked scope: before/after exported JSON plus changed-layer counts
- precise vs fuzzy: before/after screenshots plus changed-index counts

The same interaction can legitimately support more than one criterion, but do not paste the full screenshot sequence into every row. If a criterion was not independently verified, write a concrete fail reason for that criterion instead of inheriting a task-level result.

Do not overstate drag capability from weak evidence. For cumulative-ratio downward/upward drags, a pass requires target-neighborhood deltas in the intended direction plus screenshots that do not show snapback. If evidence only proves a limited movement, describe it as limited movement rather than "unlimited" or fully free dragging.

Important React-control pitfall: do not switch radio modes by directly setting `input.checked` inside `page.evaluate`. That can update the DOM visual state without updating React state, causing false failures where the top radio appears selected but the chart card still behaves as the old mode. Use a real Playwright click on the label/control, then verify both the selected radio label and downstream behavior/exported JSON.

## Visual Model Judgment Items

- "顺滑" y-axis expansion: judge from before/after screenshots, frame sequence, or recording; mark `fail` only when the visible evidence does not support smooth expansion.
- Fine-grained visual curve shape: use screenshots plus exported data, then provide a model-judged visual verdict.
- Whether the UI is "美观": use screenshots and model judgment first; mark `fail` if the screenshot evidence is incomplete or the UI visibly fails the criterion.

## Scope Discipline

The judge text is the only source of required conditions. Do not fail a point for a criterion it never states.

- Read "two decimal places" as numeric precision, not as text formatting. JSON `number` serialization drops trailing zeros, so `1.5` and `1.50` are equivalent. Compare exported values against the expected CSV point by point and pass when no value exceeds two-decimal precision.
- The filter point asks that the display and export follow the selected conditions. It does not ask for cascading option narrowing, so do not fail it because an unproductive channel/strategy combination remains selectable. Verify a valid combination drives the display and export correctly.

## Reporting

For each criterion, classify as:

- `pass`: deterministic DOM/JSON/state evidence exists.
- `fail`: required UI/data path missing, output wrong, or screenshot/frame evidence does not prove the visual criterion.

Always include screenshot paths and downloaded JSON path when available.

## Alignment-Focused Adjudication

For bidirectional chart editing, do not infer success from one exported number or a pointer event alone. Choose a point away from both bounds, record the visible point and both exported series, perform separate upward and downward drags on the flow curve and the cumulative curve, and verify that each drag direction produces the requested on-screen movement and the corresponding data change. Treat clamping at zero or at a ratio bound as boundary behavior, not proof that unrestricted upward/downward editing works. Keep screenshots immediately before, during, and after each drag so card identity, selected layer, cursor target, and curve movement remain attributable.
