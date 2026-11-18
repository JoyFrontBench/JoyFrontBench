---
name: json-transform-workbench-eval
description: Evaluate JSON transformation workbenches with synchronized Tree/Table/Raw views, generic array-path handling, immutable Original plus deterministic Result pipeline replay, correct filter/flatten/explode/group semantics, typed editing, real JSONPath/schema validation, complete exports, robust persistence, and large-data testability.
---

# JSON Transform Workbench Eval Skill

Use this skill for `frontenjoyai-028` and similar local structured-data tools.

Default method: source/domain tests plus Playwright with several JSON fixtures. Parse all exported files and save pipeline snapshots after each committed operation.

The task judge is authoritative. Use reference selectors and state fields as evidence hooks only; equivalent implementations may expose different names.

## Stable Evidence Entrypoints

The task explicitly requires these stable `data-testid` values:

- `import-json`, `tree-view`, `table-view`, `raw-editor`;
- `jsonpath-input`, `jsonpath-run`, `filter-builder`, `table-path-select`, `commit-filters`;
- `transformation-pipeline`, repeated `pipeline-step`, `schema-editor`, `validate-schema`, `validation-status`;
- `export-json`, `export-csv`, `undo`, `redo`, `row-count`, `clear-workspace`, `reset-example`, and `load-large-dataset`.

Also require Tree nodes with stable `data-path`, stable Table-row and pipeline-step identifiers, and the task-specified accessible help dialog with `role=dialog`, `aria-modal=true`, and named close/confirm controls.

Do not replace the required test IDs with semantic equivalents; use roles/names as additional interaction locators. Save DOM attributes and downloaded content, not screenshots alone.
## Workbench And View Contract

- Confirm responsibilities are split across components, transforms, utilities, store, data, storage, and tests rather than one large component.
- At `1440x900`, verify the three-column shell fits the viewport with internal scrolling and no document-level scroll.
- Tree: type cues, array lengths/object field counts, expand/collapse all, and sane default depth.
- Table: generated columns, nested dot paths, array summary/detail, selectable array path.
- Raw: format, minify, apply, revert; draft typing must not rebuild the entire tree per key.
- Help modal must be a real accessible dialog and close by top close, confirmation, backdrop, and Escape without losing work.

## Generic Array-Path Matrix

Use fixtures whose record arrays are not named `users`, including multiple arrays and nested arrays.

- Auto-discover real array paths.
- Require explicit Table selection when multiple candidates exist.
- Tree, Table, query, transforms, validation, and export must use the currently selected/visible path required by each operation. If Table filters and transform forms have separate visible path selectors, each committed step must freeze the selector from its own operation surface.
- Import invalid JSON and require current workspace preservation.
- Search source for hard-coded sample paths and prove core logic handles arbitrary keys.

Use at least: a different root array name, no arrays, two sibling arrays, a nested array, and an invalid file with a known parse position. After every path switch, compare displayed rows, filter count, committed `sourcePath`, transformed output, and CSV source.

## Original And Pipeline Replay

- Original remains immutable; Result is produced by replaying committed steps.
- Every data mutation step has stable id, type, submitted parameter snapshot, data version, and status.
- Navigation, selected view, query, temporary sort, and similar browsing state do not enter the pipeline.
- After each commit, change form controls and verify historical step parameters do not mutate.
- Test undo, redo, remove step, reset pipeline, and branch-after-undo.
- Inject a failing step: Result stops at last valid output, failed step contains concrete error, later steps become blocked/skipped.
- Remove the failed step and require deterministic recovery from Original.

Inspect state equivalent to `original`, derived `result`, `pipeline`, `redo`, `version`, `activeView`, `dataMode`, `tablePath`, transform source path, `sort`, `filters`, `query`, `schema`, validation, and recovery notice. Pipeline steps should expose the union-specific fields for value edit, rename, delete, raw apply, filter, flatten, explode, and group operations.

Replay invariant: `Result = fold(applyStep, deepClone(Original), successful prefix)`. At the first failure, Result equals the output immediately before that step, that step is `error`, every later step is `blocked`, and no later operation executes.

## Transform Semantics

All record-set transforms consume the selected array path and produce a root record array with Table path `$`:

- Commit Filter freezes path, rules, version, and AND/other documented semantics.
- Flatten genuinely flattens nested object keys with configurable separator and no wrapper-field leakage.
- Explode is distinct: missing/null/empty array -> zero rows; nonempty -> one row per item with parent fields copied; non-array -> explicit failure.
- Group By produces correct count/sum/avg/min/max, limits numeric aggregation, labels missing/null groups, and explains skipped nonnumeric values.
- A transform applied to non-array input must fail without destroying the last valid Result.

Record cardinality invariants: explode output count is the sum of lengths of valid nonempty arrays; flatten preserves record count; filter output is a subset under frozen rules; group count totals equal input count, while numeric aggregates account for skipped nonnumeric/missing values explicitly.

## Editing, Query, And Schema

- Tree edits preserve primitive type; boolean toggles remain boolean and numbers do not become strings.
- Rename conflicts are blocked; array deletion stays dense; edits affect Result only.
- JSONPath must execute real wildcard/filter expressions and return path/value/match count. Invalid expressions must not crash.
- Schema validation must actually evaluate current Result and list data path, schema rule, and message for every error.

Use exact probes such as wildcard nested arrays and boolean predicates, then compare returned paths and values to an independent JSONPath result. For Schema, deliberately violate a nested integer constraint and require all three error fields rather than a generic invalid badge.

## Export And Persistence

- Export Pretty/Minified JSON and compare semantic equality with current Result.
- Export CSV from the complete filtered and currently sorted record set, not only rendered/page rows.
- Validate order, UTF-8, null handling, quoting/newlines, and nested values without `[object Object]`.
- Clear sort and require original order on the next export.
- Reload and restore Original, replayed Result, pipeline, view/path, sort, filters, query, and schema.
- Inject unknown operation or malformed parameters; require snapshot isolation, example fallback, recovery notice, and no white screen.
- Clear Workspace must remove persistence and all work state; it is not the same as Reset Pipeline.

When present, inspect the localStorage snapshot using the key discovered from the candidate: it may omit cached Result only if reload recomputes it from Original and validated steps. Inject unknown step types and wrong field types, not only malformed JSON. Intercept Blob downloads and parse UTF-8/BOM, quoting, embedded newline, null, nested objects, row count, and sort order.

## Scale And Testability

- Load about 1000 records and exercise Tree expansion, Table scroll, filter, JSONPath, and Flatten without long freeze.
- Require stable `data-testid`, `data-path`, pipeline-step id, and row id signals specified by the task.
- Run the required test suite, count at least 20 meaningful cases, and inspect that assertions validate real transform results, path consistency, persistence corruption, modal closure, CSV completeness, and failure boundaries.

## High-Risk False Passes

- Multi-array selector changes Table while transformations still use a hard-coded array.
- Undo restores cached Result instead of replaying from Original.
- Explode preserves one row for empty arrays or silently accepts non-array values.
- CSV exports only current page/virtual viewport.
- Persistence trusts any JSON-parsable object without schema/operation validation.
- Table switches to one array while transform/export controls retain an invisible stale path.
- A test asserts pipeline statuses but never proves the blocked transform was not executed.
- Reload displays a cached Result that disagrees with replayed Original plus Pipeline.

## Runtime Stability And Rendered Output

Transform semantics are scored on what the running workbench produces, not on the correctness of the transform function.

- A click that white-screens or crashes the app fails its point outright, however sound the source semantics look. Capture the crash screenshot and the console error.
- After a flatten, explode, or group-by commit, read the Table view. Flattened columns such as `profile.tier` must actually render values; blank cells mean the output is unusable and the point fails.
- Large-dataset preconditions do not require a dedicated control. Importing roughly the required number of records by hand satisfies "load a large dataset", so do not fail the performance point merely because a `Load Large Dataset` button is absent. Score it on whether the workbench handles the volume and the follow-up operations complete.

## Recommended Evidence

- generic and multi-array JSON fixtures
- `json-workbench-path-matrix.json`
- `json-workbench-pipeline-replay.json`
- `json-workbench-transform-cases.json`
- `json-workbench-query-schema.json`
- exported JSON/CSV and persistence-corruption audit
- desktop/mobile screenshots

## Alignment-Focused Adjudication

Run each data operation from a clean, hand-computable fixture and inspect both the immediate Result and every dependent view. Continue beyond the first apparent success: filter commit must not crash; flatten must populate table cells under the chosen separator; explode must cover missing, empty, multi-item, and non-array cases; rename conflicts and delete semantics need exact state checks. For invalid JSONPath or Schema, test both entry points separately and verify the previous data remains intact. Export JSON must be parsed and deep-compared with the current Result, including types; textual byte identity is required only when the criterion explicitly concerns formatting. Performance may be tested with an imported/generated large fixture when the task does not mandate a dedicated load button.
