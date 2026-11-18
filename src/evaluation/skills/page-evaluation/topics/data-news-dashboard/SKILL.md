---
name: data-news-dashboard-eval
description: Evaluate offline data-news dashboard builders with CSV/JSON import, schema inference and quality warnings, automatic multi-chart generation, filters, insight annotations, self-contained HTML/SVG/JSON exports, persistence, and responsive editorial visual quality.
---

# Data News Dashboard Eval Skill

Use this skill for `frontenjoyai-017` and similar local visualization editors.

Treat the task and `criteria` as authoritative. Reference implementation names are optional probes, not required architecture.

Default method: run source tests, then use Playwright with controlled CSV/JSON fixtures and downloaded-file parsing. Data, chart geometry, annotations, and exports require machine-readable evidence; screenshots mainly judge editorial presentation.

## Evidence Anchors

In the GPT-5.6 reference, stable optional probes include:

- `#sample-select`, `#dataset-file`, `数据源与字段`, `数据新闻看板画布`, `全局筛选`, and `图表配置与洞察`;
- the `选择 JSON 数组` dialog, field-role selects named `<字段>字段角色`, `.chart-card`, chart `role="img"` elements, and export buttons `故事 HTML`, `配置 JSON`, `当前 SVG`;
- `window.__vizDashboardState__`, which contains schema, chart specs, filters, annotations, filtered row count, chart-data signatures, and export signatures;
- the dashboard's localStorage state, using the key discovered from the candidate;
- pure modules under `domain/data`, `domain/charts`, `domain/dashboard`, `domain/export`, and `state`.

Use equivalent handles elsewhere. Never award correctness solely because a debug object reports expected values; reconcile it with visible chart geometry and downloaded artifacts.

## Engineering Boundary

- Confirm Vite/React/TypeScript project files and runnable build/test/typecheck or lint scripts.
- Reject unpinned `latest` dependencies where the judge forbids them.
- Locate parser, type inference, quality analysis, aggregation, recommendation, geometry/render, filters, insights, export, and persistence logic outside React-only components.
- Reject remote data/fonts/images/AI/backend calls, chart-library substitution when self-drawn SVG/Canvas is required, `dangerouslySetInnerHTML`, or whole-page templates.
- Verify rendered chart SVG/Canvas geometry changes from current data rather than static placeholder art.
- Distinguish “self-drawn” from “independently testable geometry.” JSX that draws correct marks may satisfy rendering but does not satisfy a hard requirement that geometry generation be a separate importable module.

## Import And Schema Fixtures

Prepare:

- CSV with quoted comma, escaped quote, blank, percentage, date, boolean, region, and mixed numeric/text values;
- object-array JSON and root-object JSON with multiple array candidates;
- invalid and empty files;
- quality-warning fixture with missing values, bad dates, out-of-range percentages, and high cardinality.

Require:

- at least three deterministic built-in datasets across distinct topics;
- explicit array selection for multi-array JSON;
- invalid input preserves the existing dashboard;
- inference distinguishes number, category, date, percent, region, text, and boolean;
- manual type override immediately recomputes recommendations and current dashboard;
- field panel shows missing rate, unique count, range/examples, and explicit warnings for excessive missing values, bad dates, numeric/text mixing, high cardinality, and out-of-range percentages.

Snapshot dataset id/schema, card specs, filtered count, and geometry signatures before invalid import. After the error, all prior values must remain unchanged.

## Dashboard And Linkage Checks

- Each dataset switch/import should create at least four charts plus one metric card using current schema fields.
- Exercise metric, bar, stacked bar, line, area, scatter, heatmap, and small multiples.
- For each chart, audit conclusion title, subtitle, legend, unit, source/dataset, empty state, and configuration entry.
- Test Top N plus “other”, percentage total checks, and recommendation rules for date+number, category+number, number+number, and region+number.
- Apply filters/cross-filter and compare chart geometry, metrics, available records, and candidate insights against the filtered row set.
- For every dataset switch, compare field ids used by all generated specs. Reused valid-looking cards with stale field names fail.
- Force an empty filter result and verify a real empty state rather than zero-height stale marks.

## Insight Annotation Closure

- Require at least three candidates derived from real aggregates, such as max/min/growth/outlier/concentration.
- Adopt a candidate and add a manual annotation with chart id, title/body, optional field/category/date binding, and importance.
- Edit, collapse, and delete it; then delete its chart and verify cascade or explicit migration.
- Change a filter/configuration and prove candidates and export-preview values recompute.
- Reject hard-coded prose that survives unrelated dataset changes.
- If chart deletion is absent, do not infer cascade behavior from annotation deletion. That hard interaction remains unmet.

## Export Validation

- Export self-contained HTML from a non-default state and open it offline. Require current charts, titles, legends, annotations, filter summary, and source, with no editor sidebar/control UI.
- Export the selected chart as standalone SVG. If PNG is also offered, validate its documented compatibility boundary separately.
- Parse dashboard JSON and require dataset/schema, chart specs, filters, sorts, annotations, theme, source metadata, and export signatures.
- Compare exported values and SVG geometry/text with current dashboard state.
- Intercept Playwright downloads and parse the actual files. Expected reference filename patterns are `<dataset>-story.html`, `<dataset>-dashboard.json`, and `<card>.svg`, but equivalent names are valid.
- Disable network when opening HTML. Assert no dependent stylesheet/script/image requests and no editor controls.
- Compare chart kind and series semantics, not only geometry changes. Exporting every chart as the same generic bar chart is a failure even if values and shapes change.
- Require the export checklist's title, subtitle, legend, annotations, filter summary, and source. Compare units when present, but do not turn an omitted unit alone into failure of the export item.

## Persistence And Reset Closure

These are explicit task-level requirements, but the current judge has no standalone persistence child item. Record them separately and do not use them to fail an unrelated child criterion.

- Build a non-default state with a chosen/imported dataset, field-role override, chart configuration, filter, sort, annotation, selected chart, and export status; reload and compare the restored dashboard and rendered geometry.
- If the original imported file cannot be persisted, require a row-data snapshot or a clear, accurate notice of the local restoration boundary.
- Inject malformed JSON, missing/invalid chart specs, dangling field mappings, invalid enum values, and an oversized snapshot. Require bad cards/data to be dropped or a default sample fallback, a visible recovery notice, a reachable Reset action, and no white screen.
- Reset must clear imported data, filters, annotations, and configuration, restore the default sample and initial dashboard, and remain reset after reload.

## Tests And State Evidence

- The reference `src/test/domain.test.ts` exercises CSV/JSON parsing, seven roles, two warning types, recommendations, aggregations, Top N, filter intersection, insights, stable JSON, and corrupt storage.
- It does not cover browser import preservation, all required quality warnings, all eight rendered chart kinds, annotation editing/deletion/cascade, downloaded-file fidelity, offline HTML, or `360px`. Add UI/download checks for these.
- Read `window.__vizDashboardState__` after each settled interaction when available and wait for chart signatures to change before screenshotting. Then independently inspect the SVG/Canvas and downloaded content.
- Run declared scripts and report dependency/bootstrap failures separately. A test file's existence is not a pass.

## Visual And Responsive Judgment

At desktop and `360px`, ensure charts remain the primary workspace, core import/config/filter/annotation/export flows are reachable, and the design reads as a light, high-contrast data-newsroom tool rather than finance, compliance, cyber monitoring, or a marketing hero. At `360px` specifically, fail the responsive criterion when the chart workspace shifts horizontally out of the viewport, the filter/sort region occupies the main screen and pushes charts away, or the core flow cannot be completed — a desktop that merely looks like a light data-news layout does not pass the mobile criterion.

## High-Risk False Passes

- Built-in examples work because chart fields are hard-coded by name.
- A type override changes a dropdown but leaves recommendations and charts stale.
- “Insights” are static editorial sentences unrelated to aggregates.
- Exported HTML depends on project CSS or remote scripts.
- Export includes stale/default state or editor controls.
- Downloaded SVG is a generic bar fallback unrelated to the selected chart kind.
- Debug signatures change while rendered geometry or export content stays stale.
- Annotation delete works, but chart deletion/cascade is missing.
- Unit tests pass while no browser-level import/export or responsive workflow is covered.

## Responsive Usability Gates The Visual Verdict

The visual and responsive task requires the core flow to be completable at desktop **and** `360px`. Do not settle it from the desktop screenshot alone.

- Capture `360px` and check that the chart workspace stays inside the viewport, that filter and sort controls do not take over the primary screen, and that the main flow can still be completed.
- Horizontal overflow of the chart area, or secondary panels crowding out the workspace, fails the point even when the desktop layout matches the intended data-newsroom style.

## Recommended Evidence

- input fixtures and `data-import-schema-audit.json`
- `data-chart-specs-and-geometry.json` with debug and DOM-derived signatures
- `data-filter-insight-audit.json`
- exported HTML, SVG, and dashboard JSON
- desktop/mobile dashboard screenshots

## Alignment-Focused Adjudication

Test dashboard actions through a data lineage trace: selected source/field → transformation/filter → chart/table state → saved or exported result. Verify values from a small hand-computable fixture and keep source/preview/export comparisons in one run. For layout editing, measure actual movement/resizing and resulting overlap or persistence rather than accepting drag handles. When a criterion has several outputs, a correct headline or chart does not stand in for untested annotations, filters, or export fields.
