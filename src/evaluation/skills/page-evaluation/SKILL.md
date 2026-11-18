---
name: web-page-eval
description: Evaluate web pages with deterministic DOM/HTML automation, preferably through Playwright in an isolated browser, plus optional Midscene Bridge checks only when the current user Chrome tab must be inspected.
---

# Web Page Eval Skill

Use this skill when evaluating a web page, especially a React/Vite frontend where the reliable signal is in DOM state, form controls, generated downloads, localStorage, or exported JSON. Prefer this over purely visual "model sees page" checks when the acceptance criteria mention buttons, filters, CSV import, table data, export formats, validation states, or deterministic state changes.

Default to Playwright with an isolated browser window. Do not default to Midscene Chrome Extension Bridge, because repeated Bridge connections and opening/closing tabs can destabilize the user's normal Chrome session. Use Bridge only when the user explicitly needs inspection of their currently opened Chrome tab.

For most future requests, the user can provide only:

- the page URL
- the acceptance criteria or interaction task
- any required fixture files, accounts, or seed data if the page needs upload/login/test data

Then create or run a focused Playwright evaluator for that page.

## Specialized Topic Guides

When the task matches one of these tested page types, read the narrower topic guide first and keep this root `SKILL.md` as the general browser-automation policy. The current prompt repository mapping is:

| Question | Task type | Skill path |
| --- | --- | --- |
| 001 `frontenjoyai-001` | Traffic curve CSV editor | `skills/page-evaluation/topics/traffic-curve/SKILL.md` |
| 002 `frontenjoyai-002` | POS business configuration center | `skills/page-evaluation/topics/pos-config/SKILL.md` |
| 003 `frontenjoyai-003` | Code-drawn iPhone product site | `skills/page-evaluation/topics/iphone-product-site/SKILL.md` |
| 004 `frontenjoyai-004` | Mobile travel booking app | `skills/page-evaluation/topics/mobile-travel-app/SKILL.md` |
| 005 `frontenjoyai-005` | Human blood-circulation SVG | `skills/page-evaluation/topics/blood-circulation-svg/SKILL.md` |
| 006 `frontenjoyai-006` | Siamese cat and Manhattan SVG | `skills/page-evaluation/topics/siamese-city-svg/SKILL.md` |
| 007 `frontenjoyai-007` | Tiny-planet third-person game | `skills/page-evaluation/topics/planet-game/SKILL.md` |
| 008 `frontenjoyai-008` | Canvas pixel RPG | `skills/page-evaluation/topics/pixel-rpg/SKILL.md` |
| 009 `frontenjoyai-009` | Marketing Toolbox | `skills/page-evaluation/topics/marketing-toolbox/SKILL.md` |
| 010 `frontenjoyai-010` | Particle morphing 3D demo | `skills/page-evaluation/topics/canvas-3d/SKILL.md` |
| 011 `frontenjoyai-011` | Shape/node 3D demo | `skills/page-evaluation/topics/canvas-3d/SKILL.md` |
| 012 `frontenjoyai-012` | Cryogenic quench simulation | `skills/page-evaluation/topics/cryogenic-quench/SKILL.md` |
| 013 `frontenjoyai-013` | CSS/SVG 3D skeleton watch | `skills/page-evaluation/topics/css-3d-watch/SKILL.md` |
| 014 `frontenjoyai-014` | RPS AI training dashboard | `skills/page-evaluation/topics/rps-training-dashboard/SKILL.md` |
| 015 `frontenjoyai-015` | Magic academy skill tree | `skills/page-evaluation/topics/magic-skill-tree/SKILL.md` |
| 016 `frontenjoyai-016` | Three.js product landing page | `skills/page-evaluation/topics/three-product-landing/SKILL.md` |
| 017 `frontenjoyai-017` | Data-news dashboard builder | `skills/page-evaluation/topics/data-news-dashboard/SKILL.md` |
| 018 `frontenjoyai-018` | Liquid-pouring simulator | `skills/page-evaluation/topics/liquid-pouring-simulator/SKILL.md` |
| 019 `frontenjoyai-019` | 3D lattice migration workbench | `skills/page-evaluation/topics/lattice-migration-3d/SKILL.md` |
| 020 `frontenjoyai-020` | Mobile finance dashboard | `skills/page-evaluation/topics/mobile-finance-dashboard/SKILL.md` |
| 021 `frontenjoyai-021` | Waste-sorting game | `skills/page-evaluation/topics/waste-sorting-game/SKILL.md` |
| 022 `frontenjoyai-022` | Wildlife alert review workbench | `skills/page-evaluation/topics/wildlife-alert-review/SKILL.md` |
| 023 `frontenjoyai-023` | FPS survival arena | `skills/page-evaluation/topics/fps-arena/SKILL.md` |
| 024 `frontenjoyai-024` | Four-stroke engine simulator | `skills/page-evaluation/topics/engine-simulator/SKILL.md` |
| 025 `frontenjoyai-025` | Pitch-by-pitch baseball simulator | `skills/page-evaluation/topics/baseball-simulator/SKILL.md` |
| 026 `frontenjoyai-026` | Parameterized SVG poster generator | `skills/page-evaluation/topics/svg-poster-generator/SKILL.md` |
| 027 `frontenjoyai-027` | Canvas image editor | `skills/page-evaluation/topics/canvas-image-editor/SKILL.md` |
| 028 `frontenjoyai-028` | JSON transformation workbench | `skills/page-evaluation/topics/json-transform-workbench/SKILL.md` |
| 029 `frontenjoyai-029` | Octopus drummer SVG | `skills/page-evaluation/topics/octopus-drum-svg/SKILL.md` |
| 030 `frontenjoyai-030` | Evidence timeline review workbench | `skills/page-evaluation/topics/evidence-timeline-review/SKILL.md` |
| Legacy compatibility | Pelican bicycle SVG | `skills/page-evaluation/topics/pelican-bike-svg/SKILL.md` |
| All questions | Report generation and evidence layout | `skills/report-generation/SKILL.md` |
| All questions | Post-run judge and integrity audit | `skills/judge/SKILL.md` |

URL-only is enough when the page is public or already contains built-in demo data. Ask for extra inputs only when needed:

- login credentials or auth cookies for protected pages
- fixture files for upload flows, such as CSV files
- target business IDs, tenant IDs, or known records for search/edit flows
- strict visual design rules if the criterion is subjective

## Quick Commands

From the release repository's `src/evaluation` directory:

The primary flow reads `dataset.json + tasks/*.md + judge/*.json`, runs the candidate, reads frozen reference frames for pairwise tasks, and then runs the strict judge:

```bash
npm run eval:batch -- \
  --prompts=/path/to/data \
  --workspace-root=/path/to/runs \
  --benchmark-root=/path/to/release/references \
  --output-root=/path/to/fresh-output
```

Inspect selection without launching browsers:

```bash
npm run eval:batch -- \
  --prompts=/path/to/data \
  --workspace-root=/path/to/runs \
  --benchmark-root=/path/to/release/references \
  --output-root=/path/to/fresh-dry-run-output \
  --dry-run
```

For a single question, use the same JSON dataset:

```bash
npm run eval -- \
  --prompts=/path/to/data \
  --workspace=/path/to/question-workspace \
  --benchmark=/path/to/release/data/references/frontenjoyai-001 \
  --id=frontenjoyai-001 \
  --output-root=/path/to/fresh-question-output
```

After every batch or targeted run, run the judge audit before treating the results as final:

```bash
npm run judge
```

For final delivery or when the user challenges coverage, use strict mode:

```bash
npm run judge:strict
```

When the user's normal Chrome can open a Vercel page but Playwright or `curl` times out, check the system proxy and run the evaluator with the same proxy. On this machine the stable setting is:

```bash
npm run eval -- --proxy=socks5://127.0.0.1:7897
```

If `curl --proxy http://127.0.0.1:7897` succeeds but headless Chrome returns `net::ERR_CONNECTION_CLOSED`, retry Playwright with `socks5://127.0.0.1:7897`. Do not overwrite an existing valid report with a transient network-blocked result.

Useful filters:

```bash
npm run eval -- --id=web1
npm run eval -- --row=57
```

Rewrite reports from existing `eval-summary-results.json` without rerunning browser interactions:

```bash
npm run eval:report-only
```

Report output is split by format:

- Markdown reports: `eval-output/reports/md/`
- HTML reports: `eval-output/reports/html/`
- Summary/judge JSON: `eval-output/reports/`

For current report layout rules, read `skills/report-generation/SKILL.md` before editing report code or delivering final report links.

Direct evaluator command:

```bash
MIDSCENE_ROOT=/path/to/midscene \
  node legacy-midscene-adapter/evaluate-web-page.mjs --profile basic
```

For traffic-curve runs, use the project fixture unless another CSV is specified:

```bash
npm run eval -- --fixture-csv=fixtures/traffic_curve_sample.csv
```

Midscene Chrome Extension Bridge is not part of the default auto-eval runner. Use it only if explicitly reintroduced for current-tab inspection.

## Browser Automation Policy

Use this order:

1. **Playwright isolated browser**: first choice for repeatable evaluation, recording, screenshots, DOM assertions, clicking, form input, navigation, and downloads. Launch a separate browser/profile and close it after the run.
2. **Puppeteer isolated browser**: acceptable fallback if Playwright is unavailable.
3. **Midscene Chrome Extension Bridge**: use only for the user's existing Chrome tab or when testing the extension bridge itself.

Avoid running multiple Bridge sessions or repeatedly opening tabs through Bridge. If Bridge must be used, run one small check at a time and clean up processes before the next check.

## Evaluation Strategy

Use a **deterministic-first, interaction-second** judging strategy:

1. **Prefer direct deterministic evidence** when it can fully prove the validation point: source code inspection, DOM structure/text, attributes, computed styles, accessibility tree, route/state, `localStorage`/`sessionStorage`/IndexedDB, network payloads, downloaded/exported files, parsed JSON/CSV, canvas/WebGL debug state, pixel diffs, or time-series samples. If these signals directly prove the criterion, judge from them first instead of mechanically following a reference click path.
2. **Use minimal necessary interaction** when a deterministic signal only becomes meaningful after setup. For example, click a tab, upload a fixture, change a filter, drag a point, or press a key only far enough to expose the state that will then be verified through DOM/data/state/pixel evidence.
3. **Fall back to the validation protocol** when static DOM/code evidence cannot prove the criterion, when the criterion is explicitly about an end-to-end flow, or when the only reliable signal is experiential, visual, or animated behavior. The steps may be followed exactly or by an equivalent path, but the report must explain the observable result.

Screenshots are still first-class evidence by default: every browser evaluation should leave visual evidence that the model can inspect. However, screenshots do not replace deterministic pass/fail evidence for data, DOM, state, validation, downloads, or business-rule claims.

Important nuance: "DOM/code first" is not a license to ignore interaction semantics. If the validation point says the user action must change something, the evidence must prove the before/after effect, either by executing the interaction or by citing code/runtime state that unambiguously proves the same behavior.

## Visual Model Judgment Policy

For visual or subjective criteria such as 美观、精致、高端、清晰、统一、顺滑、毛玻璃、电影感、不过曝、无错位、信息密度合理, do not default to `fail` just because the criterion is subjective. Capture the relevant screenshots, crops, or frame sequence, inspect them with the model, and give a first-pass visual verdict.

- Use `pass` or `fail` when the screenshot evidence is sufficient to judge the criterion.
- Use `fail` only when the visual target is not visible, evidence is missing, animation frames are too sparse to judge, or the criterion requires information outside the page/screenshot.
- In the reason, state that the result is `model-judged` and cite concrete visible observations such as spacing, alignment, contrast, overlaps, legibility, glow intensity, consistency across screens, or frame-to-frame change.
- Model judgment does not replace deterministic checks. Data, DOM, JSON, localStorage, disabled states, downloads, and business rules still require machine-readable evidence.

Fixed output locations:

- screenshots: `eval-output/screenshots/`
- reports: `eval-output/reports/md/` and `eval-output/reports/html/`
- summary/judge JSON result files: `eval-output/reports/`
- downloaded files used as evidence: `eval-output/downloads/`
- DOM/layout evidence data: `eval-output/data/`

For batch or multi-question evaluation, generate one summary report plus one report per question in both Markdown and HTML. List every explicit JSON criterion as an independent row and attach relevant screenshot/file evidence. Pointwise rows use `pass`, `fail`, `blocked/network`, or `error`; pairwise rows record comparison observations without a child score. For visual criteria, include concrete visual rationale. Prefer the HTML report for review because it can keep multiple screenshots and JSON previews readable inside the criterion table.

For 3D/WebGL/demo pages, capture both full-page context screenshots and cropped subject screenshots. Full-page screenshots prove controls and layout, but the model or effect can look tiny in Typora. Add `*-detail.png` crops around the canvas subject for phase-by-phase evidence, and reference the detail crops in visual or physics criterion rows.

Evidence density depends on the topic:

- Business software / admin tools: prioritize DOM, JSON, localStorage, downloaded files, disabled states, validation state, route state, and result counts. Screenshots should show important before/after UI states, but every criterion does not need a unique screenshot if machine-readable evidence proves it.
- Games, 3D, animation, charts with drag physics, and scrolling/hover motion: capture sequences. A single static screenshot cannot prove smooth movement, camera follow, AI chasing, gravity, animation stages, or drag continuity. Use before/during/after screenshots, cropped detail shots, pixel comparisons, and time-series state samples.
- For 3D/WebGL drag rotation or wheel zoom (`鼠标自由旋转视角`, `鼠标拖拽旋转球体`, `OrbitControls`), judge interaction response separately from visual quality. A pass needs observable response evidence such as before/after pixel change, camera/control state delta, or visible orientation/scale change. Do not fail the drag/zoom item only because Bloom is too strong, the object is a glowing solid ball, or nodes/structure are unclear; score those under the separate visual clarity/Bloom/structure criteria.
- Visual-only criteria should be model-judged directly from screenshots with concrete observations. Do not write "manual", "partial", or vague "provided screenshots for judgment" language.

The authoritative input is `dataset.json` and each referenced Judge JSON's `tasks[]`. Keep `task` as the requirement title/context; pointwise report rows are driven by the explicit `criteria[]` objects. Spreadsheet columns and Markdown headings are not part of the release input contract.

Read each `criteria[]` object's `criterion_id` and `text` directly. Preserve IDs, array order, concrete objects, field names, files, values, and operation targets. Do not split criterion text again by numbering, checklist bullets, semicolons or Markdown; do not reorder, merge, drop, renumber or invent criteria. The pipeline context exposes the same texts as `criteria` and the corresponding IDs as `criterionIds`; `criteriaText` is only a generated display view.

Read `instructions`, `validation.description` and the ordered `validation.steps` as judging context and the reference execution protocol. Do not discard them or count them as additional criteria. For each criterion, use complete deterministic DOM/source/data/state evidence when sufficient; otherwise execute the relevant preconditions and interaction path or an explicitly equivalent path. Match steps to criteria by their meaning, not by assuming that step numbers equal criterion IDs.

Include a `Criterion 评定` section in the report. Each pointwise criterion has its own status, concrete reason and evidence. Pairwise criteria contain comparison reasons and evidence only, with no child status or score. Do not collapse multiple criteria, such as separate curve-drag requirements, into one row.

For pointwise tasks, score only criterion rows without counting the task summary again. For pairwise_gsb tasks, criterion rows record comparisons and evidence only; the numeric score comes from the single task-level G/S/B verdict.

In the `Criterion 评定` table, keep evidence inside the corresponding criterion row. If one criterion has multiple screenshots or files, extend that entry into multiple table rows or cells with rowspans for the text columns. Do not squeeze many images into one cell, and do not move screenshots to a detached gallery as the primary evidence. A separate screenshot archive can exist after the table for traceability.

JSON evidence must be visible directly in the report and also linked as a file. Render JSON as a linked filename plus an inline preview in an expandable `<details>` block. Truncate long JSON previews, but state the full character count and preserve the link to the complete file.

Do not write generic fallback reasons such as “缺少该校验点的专项自动化证据”, “原大项结论”, “父项综合结果”, or internal mapping wording in the human report. If a criterion was not actually checked, give a specific `fail` reason tied to that criterion, for example “未执行筛选后再次导出，因此无法验证 metadata 是否与当前筛选一致”, and attach the most relevant available screenshot or data. If existing evidence does support the criterion, write the concrete observation directly instead of explaining internal alignment.

Do not reuse unrelated task evidence for criteria that were not independently executed. Shared evidence is acceptable only when the same action/result genuinely proves multiple criteria, and the reason must say the concrete shared observation. Reusing the same screenshot for every criterion row while claiming `pass` hides coverage gaps and is not acceptable.

Read every selected `dataset.json` question and every task in its Judge JSON. Require nonempty `criteria[]`, explicit IDs and a supported `judge_mode`; invalid input is an error, not permission to infer a replacement rubric. Tested and benchmark workspaces come from the pipeline inputs, not the dataset index. Before running automation, create a coverage checklist keyed by question ID, task ID and criterion ID; afterward, compare reports against that checklist. The compatibility `row` field means the public question number, never a spreadsheet row.

Always perform a post-run judge pass. Evidence gaps should be reported as `fail`, but visual subjectivity alone is not enough reason to skip a model judgment. The judge must catch unsupported `pass`, missing evidence, unrelated evidence reuse, duplicated generic screenshots, missing Judge tasks, stale network reports, and criteria that were never independently tested. Treat judge findings as follow-up work: either add targeted automation and rerun, or mark the unsupported claim as `fail` with a concrete criterion-specific reason.

The judge must also catch validation points that ignored necessary interaction semantics. A child criterion is not fully covered merely because its text appears in the report; the audit should verify that validation point N maps to `criteria` item N and that the evaluator either (a) supplied complete deterministic DOM/code/data/state evidence, or (b) used the corresponding setup/action sequence or an equivalent path, or (c) recorded why the sequence could not be completed.

Do not accept lazy evaluation output. In this context, "lazy" means: only taking screenshots, clicking without checking effects, using a task-level summary to hide untested criteria, copying unrelated evidence into criterion rows, reusing identical screenshots as generic proof, or ignoring judge findings instead of rerunning or downgrading.

Use four evidence layers, chosen in deterministic-first order:

1. **Source/DOM/state inventory**: source code signals, title, URL, buttons, labels, inputs, selects, canvas count, anchors, visible text snippet, computed style, route, storage, and exposed debug state.
2. **Result verification**: parse exported JSON/CSV, intercept `Blob` downloads, assert metadata, key structure, array lengths, edited values, validation errors, disabled/enabled states, result counts, or pixel/time-series deltas.
3. **Minimal DOM interaction**: click buttons, change selects/radios/checkboxes, open help modal, switch curve modes, inject CSV into file inputs, drag/wheel/key only when needed to expose a verifiable result.
4. **Screenshots/recordings/model judgment**: capture the initial page and every important changed state. For toggles, tab switches, sidebars, chart modes, 3D shape changes, drag/zoom, and validation state changes, capture before/after screenshots. For subjective visual criteria, screenshots/crops/frame sequences may be primary evidence, but the reason must say it is model-judged.

Use DOM/JSON/localStorage as the deterministic judge, and screenshots/recordings as visual evidence. For visual tasks, screenshots may be the primary evidence; the final verdict should say which parts are model-judged subjective visual conclusions.

## Acceptance Triage

Classify each acceptance item before writing automation:

| Type | Examples | Automation judgment |
| --- | --- | --- |
| Structure/state | buttons, search boxes, filters, tables, cards, tabs, routes, labels, disabled states | Strongly automatable with DOM assertions |
| Data transformation | CSV import, 144-point time axis, missing values padded with `0`, export JSON arrays | Strongly automatable through fixture injection and exported data parsing |
| Interaction with observable state | search results change, modal opens, config override count changes, validation errors appear | Strongly automatable; assert downstream effects |
| Canvas/chart internals | drag curve point, y-axis expansion, linked curve change | Automatable only with a specialized test: fixed viewport, calculated coordinates, pointer events, and exported/state data assertions |
| 3D canvas camera interaction | mouse free-rotate, drag sphere, OrbitControls zoom | Automatable with fixed viewport, real pointer/wheel events, before/after frames, screenshot pixel deltas, and camera/control state when exposed; keep visual clarity/Bloom failures separate |
| Subjective visual quality | "enterprise style", "beautiful", "clear", "smooth animation" | Model-judged from screenshots/crops/frame sequences first; also use objective checks such as no white screen, no obvious overlap, component density. Use `fail` only when evidence is insufficient |
| Missing product path | required button/text does not exist, such as `重新创建` when page only has `继续该任务` | Report as product not satisfying requirement; do not fake the flow |

Never mark an item as passed just because an automation command ran. A pass needs an observable effect: DOM text changed, result count changed, JSON changed, localStorage changed, button disabled/enabled state changed, downloaded file content changed, or a visual criterion has concrete model-judged screenshot observations. For `pointwise` tasks, final scoring is based on criterion rows; `pairwise_gsb` tasks are scored by the G/S/B verdict instead — see **Scoring Model (`pointwise` vs `pairwise_gsb`)**.

If the page cannot be reached after retries and Chromium shows `ERR_CONNECTION_CLOSED`, `ERR_TIMED_OUT`, or another `net::` navigation error, mark every requirement in that group as `blocked/network`, save the Chrome error-page screenshot, and do not convert it into product `fail`.

## Scoring Model (`pointwise` vs `pairwise_gsb`)

Every Judge JSON task carries an explicit **`judge_mode`** field. Only two values are accepted (see `src/evaluation/scripts/lib/tasks.mjs`):

- **`pointwise`** — per-criterion scoring.
- **`pairwise_gsb`** — one task-level GSB comparison against the benchmark.

`judge_mode` is **per task**, so one question may mix `pointwise` and `pairwise_gsb` tasks.

- **Task weight is always `1/N`**: if a question has N Judge tasks, each task is worth `1/N` of the question score regardless of its mode. The question total is `Σ (1/N × task_score)` over all tasks. Task and criterion counts come from the JSON arrays, not spreadsheet metadata.

- **`pointwise` task**: score by the criteria in its `criteria` section. If the task has M criteria, each criterion is worth `1/M` of the task (`1/(N·M)` of the question). Judge each criterion pass/fail and set `task_score = passed_criteria / M`.

- **`pairwise_gsb` task**: do **not** use child-point equal division for the numeric score. Compare the tested product against the benchmark product (标杆模型) on this task's `criteria` focus, decide G/S/B, and map it:
  - **G — 被测优于标杆** → `task_score = 100%`
  - **S — 被测与标杆相当** → `task_score = 50%`
  - **B — 被测劣于标杆** → `task_score = 0%`

  The released benchmark is a frozen visual scene bundle, not an application. Inspect its PNGs alongside fresh candidate evidence and attach 1–2 concrete relative-difference observations on this task's focus. Do not install or launch a visual reference. Explicitly selected custom reference applications remain experimental and use the `live-workspace` protocol. Still list the task's criteria as context and evidence; the numeric score comes from G/S/B, not criterion pass counts.

  **One completed task carries exactly one GSB verdict.** A `pairwise_gsb` task with `status = completed` produces a single task-level G/S/B — never one verdict per criterion, and never an average of several child verdicts. Criterion rows are comparison dimensions and evidence sources only; they are never scored on their own. Emitting zero or two-or-more GSB verdicts for a completed task is a structural error, not something to average away. A valid non-completed pairwise task (`blocked` or `needs_review`) must instead carry `gsb = null`.

Report both the per-task score and the aggregated question score, and state each task's `judge_mode` (`pointwise` / `pairwise_gsb`) so the total is reproducible.

### GSB Decision Ladder

A GSB verdict must be reached by walking these steps **in order** and stopping at the first one that decides. Never jump straight to an overall impression, and never count child points like votes.

**Step 0 — Comparability gate**

For `reference.mode = visual` (`frozen-visual`), read the verified scene manifest
and PNGs copied into this run. They are explicit evaluation inputs under the
freshness policy, not old candidate results or verdicts. Only the candidate runs.
Match each scene's viewport, locale, timezone, reduced-motion setting, equivalent
input state and semantic action sequence. Paths and selectors of the private
reference need not exist in the candidate. This is aesthetic comparison, not
pixel matching. A completed task must inspect all relevant scenes and their
ordered frames, list those PNGs as benchmark evidence, and record
`reference_protocol` and `reference_scene_ids` in `comparison_meta`.

Missing/corrupt reference images block the comparison. A valid bundle that lacks
necessary observable states yields `needs_review`, not an assumed pass or tie.
Finite frames do not establish continuous smoothness, arbitrary-time correctness,
source constraints, hidden data relationships or asset originality. Keep the
rubric unchanged; if an unobservable requirement decides a high-priority
dimension, report the evidence limit. Never seek unpublished reference code or
replace the frozen images to avoid an unfavorable result.

For an explicitly selected custom reference application, instead confirm:

- both the tested product and the benchmark launch and render;
- identical viewport, identical initial state, identical interaction path, comparable sampling moment.

If either side cannot launch, or the two sides were not driven the same way → `status = blocked`, `gsb = null`. Do **not** award G because the benchmark failed to open, and do **not** award B because the tested product failed to open — an unreachable side is a `blocked` comparison, handled by the scoring skill's exception policies, not a product verdict.

**Step 1 — Identify the high-priority dimension(s) from the task text**

The high-priority dimension is whatever this task's `task` field **explicitly demands**. Aesthetic requirements are the dominant form in the current question bank, and for those the aesthetic judgement leads — consistent with what the task itself asks for.

| What the `task` field demands | High-priority dimension |
| --- | --- |
| 审美 / 风格 / 氛围 / 视觉冲击力 / 视觉一致性 | **Aesthetic & style achievement** — style consistency, visual hierarchy and focal subject, restrained palette, typographic tension, finished-product quality |
| 结构 / 分组 / 语义或解剖正确性 | **Structural & semantic correctness** — grouping independence, position and connection relationships |

Everything the task text does **not** demand — details that appear only as auxiliary rows under `criteria` (one spacing value, a single corner radius, a non-critical label position) — is **low-priority**.

State the high-priority dimensions you selected in `comparison_meta.high_priority_dimensions` so the verdict is auditable.

**Step 2 — Critical-defect override → B**

If the tested product has a **critical defect that the benchmark does not**, the verdict is **B** immediately; do not proceed to dimension comparison. Critical defects must be observable and evidenced:

- blank screen, core region not rendering, primary subject missing;
- severe misalignment or occlusion that makes the core operating area or the main visual unusable;
- a hard requirement of the high-priority dimension is wholly unmet (e.g. the task demands 4-bit pixel art and the result is ordinary vector illustration).

**Symmetric rule**: if the **benchmark** has a critical defect the tested product does not, the verdict is **G** by the same reasoning.

**Step 3 — A decided high-priority dimension settles G/B**

If one side is clearly better on a high-priority dimension, the verdict is **G** or **B** right there. Do **not** continue into low-priority details and do **not** weight them against the high-priority result — a high-priority win is not offset by low-priority losses.

"Clearly better" requires 1–2 concrete, observable difference observations. "It looks nicer" is not a verdict.

**Step 4 — S is narrow**

Award **S** only when **every** high-priority dimension is genuinely comparable between the two sides, **and** all remaining differences are confined to non-critical low-priority details.

S is not the default and not a way to avoid committing.

**Step 5 — Fallback: do not force an S**

If the high-priority dimensions split (each side clearly better on a different one) with no defensible way to rank them, or the evidence is too thin to support any verdict → `status = needs_review`, `gsb = null`. Record the specific disagreement and what evidence is missing. This state is an exception item for scoring, and it is excluded from GSB agreement comparison — it is never silently converted into S.

**Prohibited in every step**

- Do **not** treat criteria as a tally ("won 4 of 7 criteria, therefore G"). Criteria supply the comparison dimensions; they are not votes and they are not scored independently.
- Do **not** inflate the tested product because the benchmark is weak overall. A benchmark defect is handled by the Step 2 symmetric rule, still measured against the task's requirements.
- Do **not** infer G/S/B from `pointwise` pass/fail results of the same or any other task.
- Do **not** rely on a pre-supplied conclusion for a specific task or product. Every verdict must come from this round's own evidence.

## Playwright Pattern

Use the local pnpm-installed Playwright package:

```js
import playwright from '../node_modules/.pnpm/node_modules/playwright/index.js';

const { chromium } = playwright;
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});
```

For React controlled inputs, set values through the native setter and dispatch input/change events:

```js
await page.locator('input[placeholder="搜索租户名称 / 租户ID"]').evaluate((input, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const oldValue = input.value;
  setter.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(oldValue);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, '100001');
```

Always assert downstream effects, not just the click/input action itself.

For Ant Design controls and other custom widgets, Playwright is still the preferred test method. If `locator.click()` times out, do not immediately mark the feature untested or failed. First inspect the Playwright call log, the screenshot, `elementFromPoint`, bounding boxes, and visible text:

- If another element intercepts the click, record the blocker in the audit JSON and screenshot.
- Try the actual visible click point, such as the right side of an Ant Select selector, before giving up on the downstream flow.
- For controlled inputs/selects, confirm the selected text/value changed after the interaction.
- If the only user-visible hit area is genuinely covered or clipped, mark the relevant layout/usability child criterion `fail`; do not hide it by using only forced or programmatic interaction.
- A forced click, coordinate click, keyboard open, or JS state set may be used as a diagnostic second path to test downstream business logic, but the report must distinguish this from normal user-operable behavior.

For recording-friendly demos, use headed mode, `slowMo`, short waits after important actions, and one visible browser window:

```js
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  slowMo: 180,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});
```

Keep recording scripts stable:

- Prefer one page and route navigation inside the same Playwright browser.
- Avoid long destructive flows, such as publish, in the same demo script unless that is the only target.
- Log concise state snapshots after each visible step.
- Save screenshots after each visible step; for changing interactions, save at least before and after.
- Use direct routes for wizard steps when the app supports them, but state clearly that this is a test shortcut.
- If the app uses localStorage seed data, isolated browser profiles may start empty; either seed localStorage explicitly or use app flows that load data on demand.

## Lessons From The Two Tested Pages

### Traffic Curve Editor

Good reusable checks:

- inject CSV through the hidden file input with a constructed `File` and `DataTransfer`
- check generated channel, strategy, user-layer, date, and time options
- verify the 10-minute axis has exactly 144 values from `00:00` to `23:50`
- intercept Blob downloads and parse exported JSON
- verify `metadata`, `flow_values`, `cumulative_ratio`, key names, array lengths, and rounded values
- test missing time points by importing a sparse CSV and verifying exported values are padded with `0`
- verify filters by observing visible card/canvas counts and exported scope

Harder checks:

- Canvas drag behavior has no DOM node per point; use a fixed viewport and calculated chart coordinates.
- Drag pass/fail should be backed by exported JSON or app state, not only by screenshot.
- "Smooth y-axis expansion" is not fully provable from JSON. Use video/frame checks and make a model-judged visual verdict from the available frames; mark `fail` only if the frames are too sparse or the expansion is not visible.

### POS Business Configuration Center

Good reusable checks:

- task list search and filters through DOM
- template cards, status tags, disabled cards, and `cursor`/`opacity`
- Ant Design form controls and button disabled states
- config edit changes by observing coverage/error counters
- restore-to-template by observing coverage counters return to the original value
- precheck errors and disabled next-step button
- localStorage draft entries after saving drafts

Observed product result:

- `100001` validation shows `该租户存在未完成的入驻任务` and `继续该任务`.
- It does not show `重新创建`, so that acceptance substep currently fails.
- With `100005`, all 4 enabled templates exist and can be selected. The current page showed no `推荐` tags, and the legacy restaurant template was still selectable despite displaying `不可选`.
- For disabled-template claims, do not rely on text tags alone. Click the visible legacy-template radio and try `下一步：配置编辑`; if it becomes checked or proceeds, the disabled-template criterion fails.

## POS Page Checks

Use the caller-provided local workspace and the current Judge JSON. Do not depend on a private deployment or reuse another run's verdicts.

Reusable checks include task search, template selection, configuration inheritance, draft restoration and precheck errors. Inspect actual controls and downstream state changes; a visible disabled label is not evidence that the control is disabled. Capture fresh evidence for every verdict.

## Good Candidates For DOM Evaluation

- Page does not white-screen.
- Buttons exist and are enabled.
- Help modal opens and contains expected keywords.
- Select options are generated from imported data.
- Filters actually change visible cards/canvases.
- CSV import updates page state.
- Batch edit controls exist and can change exported data.
- Export buttons generate parseable JSON with correct metadata and arrays.
- 10-minute time axis has 144 points from `00:00` to `23:50`.
- Missing time points are filled with `0` in exported data.

## Poor Candidates For Pure DOM Evaluation

- Canvas drag interactions.
- Real-time drag rendering.
- Y-axis expansion on drag.
- Pixel-level chart correctness.
- Complex hover-dependent or coordinate-sensitive links.

For these, combine fixed viewport, calculated canvas coordinates, raw pointer events, screenshots, and exported JSON inspection.

## Profiles

### `basic`

Reads current page DOM and reports:

- page title and URL
- button groups
- label groups
- selects and option counts
- inputs
- canvas count
- anchors
- visible text snippet

### `traffic-curve`

For the "流量曲线编辑工具" class of pages. It can inject a CSV with `--csv`, then checks:

- controls and counts
- 144-point 10-minute time selects
- help modal opens
- user-layer filter changes canvas count
- `全选` / `清空` work
- edit mode labels update
- curve switch buttons change all curve type labels
- export buttons produce JSON with `metadata`, `flow_values`, `cumulative_ratio`
- exported arrays are length 144

### `traffic-curve-missing-points`

Injects an internal CSV with only a few time points, exports JSON, and verifies:

- each curve is padded to 144 points
- missing points are `0`
- known input points keep their original values
- cumulative ratio arrays are also length 144

Pass `--restore-csv <path>` to restore the page to normal data after the test.

## Interpreting Results

The script prints JSON. Treat `passed: true` as the top-level pass flag for the selected profile. If it is false, inspect `checks`, `failures`, and the relevant profile-specific sections.

Do not claim a button "works" only because `.click()` ran. A good assertion must observe a downstream effect, such as DOM text changing, option values changing, canvas count changing, modal appearing, or exported JSON changing.
