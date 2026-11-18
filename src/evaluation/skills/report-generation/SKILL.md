---
name: web-page-eval-report-generation
description: Generate and audit web-page evaluation reports with separate Markdown and HTML outputs, criterion-level scoring, evidence tables, one screenshot per evidence cell, inline JSON previews plus file links, and summary links.
---

# Web Page Eval Report Generation

Use this skill whenever editing report-generation code, rewriting evaluation reports, or deciding how evidence should appear in the final artifacts.

## Output Contract

Generate both formats for every selected question:

- Markdown: `eval-output/reports/md/<row>-<id>-report.md`
- HTML: `eval-output/reports/html/<row>-<id>-report.html`
- Markdown summary: `eval-output/reports/md/eval-summary-report.md`
- HTML summary: `eval-output/reports/html/eval-summary-report.html`
- Machine-readable summary: `eval-output/reports/eval-summary-results.json`

Machine-readable results include `buildAndRuntime` (`status`, `reason`, `evidence`)
and `scoreSummary.stage` (`pre_audit`).

The summary table must link to both the Markdown and HTML report. Prefer HTML for human review because Typora can shrink complex Markdown image tables too aggressively.

## Report Structure

Each question report must contain:

1. Basic metadata: id, row, URL/final URL, profile, and overall status derived from criterion rows.
2. `要求列表`: show each Judge JSON `task` and its `criteria[]`; include its instructions and validation protocol as context, not extra scored rows.
3. `Criterion 评定`: the authoritative scoring table, one row per parsed criterion.
4. `截图全集`: archive all captured screenshots for traceability.

For pointwise tasks, score criterion rows without also counting the task summary. For pairwise_gsb tasks, criterion rows contain comparison reasons and evidence only; use one task-level G/S/B verdict for scoring.

Read `criterion_id` and `text` from each JSON `criteria[]` object. In pipeline context, use the paired `criterionIds` and `criteria` arrays. Preserve explicit IDs, array order and exact text; never split or renumber the generated `criteriaText` display view. Keep `instructions` and `validation.steps` as context, not additional scored criteria.

Each pointwise criterion row must contain a status, a concrete criterion-specific reason and evidence. Pairwise criterion rows contain reasons and tested/benchmark evidence only, never a child status, G/S/B or score. Do not expose internal mapping phrases such as “对齐到已有自动化子项”, “缺少该校验点的专项自动化证据”, “原大项结论”, or “父项综合结果” in human-facing reports.

Allowed pointwise criterion statuses are `pass`, `fail`, `blocked/network` and `error`. Pairwise task status uses `completed`, `blocked` or `needs_review` according to the task-level GSB contract. Do not invent `manual`, `partial` or vague status values.

## Evidence Table Rules

Keep evidence in the `Criterion 评定` table. Do not put the primary evidence only in a detached section below the table.

For a criterion with multiple evidence files:

- Render the text columns once with `rowspan`.
- Put exactly one screenshot or one file preview in each evidence row/cell.
- Add more rows for more screenshots instead of placing multiple screenshots in the same cell.
- Use stable image widths in HTML so screenshots stay readable.

This is required for games, 3D demos, animations, drag interactions, and other long-running visual flows. Business/admin tools may have fewer screenshots when DOM/JSON evidence is stronger, but important before/after states still need screenshots.

## JSON Evidence

JSON evidence must be both visible and linked.

For every JSON evidence file in a criterion row:

- Show a file link, for example `文件：57-frontenjoyai-009-marketing-toolbox-audit.json`.
- Render an inline JSON preview in an open or expandable `<details>` block.
- Pretty-print valid JSON.
- Truncate long previews to keep the report usable.
- State that the preview is truncated and show the full character count.
- Keep the link to the full JSON file.

Do not make reviewers open JSON files just to see the basis of a deterministic verdict. The file link is still required for the complete raw evidence.

If the same large JSON file appears in many rows, a targeted excerpt per child criterion is best. If that is not implemented, repeated inline previews are acceptable before link-only evidence because visibility is more important than compactness.

## Screenshots

Screenshot density depends on the task:

- Business/admin tools: use screenshots for important UI states and DOM/JSON/localStorage for deterministic details.
- Games, 3D, animation, charts, drag, scrolling, hover, and continuous visual effects: capture sequences and detail crops. A single static screenshot cannot prove motion, smoothness, stage progression, or interaction continuity.
- For visual criteria, give a model-judged `pass`/`fail` from screenshots with concrete observations.

Do not reuse one generic screenshot as proof for many unrelated child criteria. Shared evidence is acceptable only when the same interaction genuinely proves those criteria and the reason states the concrete shared observation.

## Commands

Rewrite reports from the existing current summary without browser rerun:

```bash
npm run eval:report-only
```

Targeted rerun:

```bash
npm run eval -- --id=web3
npm run eval -- --row=22
```

After report generation, run judge:

```bash
npm run judge
npm run judge:strict
```

Syntax check report code after edits:

```bash
npm run check
```

## Integrity Checks

Before delivery, verify:

- Every selected question has both `.md` and `.html`.
- Every linked screenshot/file exists.
- JSON evidence appears inline and still links to the raw JSON file.
- Multiple screenshots for one criterion are rendered as multiple evidence rows/cells, not squeezed into one cell.
- The summary links point to `reports/md/` and `reports/html/`.
- The judge report has no high-severity issue for missing evidence, unsupported pass, or lazy screenshot reuse.
