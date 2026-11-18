---
name: marketing-toolbox-eval
description: Evaluate Marketing Toolbox / 营销百宝箱 pages, including two-column layout, sidebar collapse, enabled/disabled tools, assistant default state, promotion query form, quick scenarios, validation, result rendering, and screenshots.
---

# Marketing Toolbox Eval Skill

Use this skill for "营销百宝箱" and marketing workbench pages.

Default browser method: Playwright isolated Chrome. Capture screenshots for initial page, sidebar collapsed/expanded state, form validation, and query result states.

## Strong Automated Checks

- Brand/title visible: 营销百宝箱 or Marketing Toolbox.
- Two-column workbench signals exist: sidebar/navigation and main execution area.
- 智能助手 is the default or primary active item when required.
- 调度任务 is visibly disabled or marked 待开放 when required.
- 历史会话 placeholder is visible when history is not implemented.
- Top tools are visible: 促销查询、优惠券查询、价格巡检.
- Only 促销查询 is actually available when required; other tools should not switch to active full flows.
- Sidebar collapse changes width/class/text; verify before/after metrics and screenshots.
- Query form has required target/site, SKU ID, and user PIN fields.
- Empty submit triggers required validation.
- Quick scenario buttons fill data or trigger expected simulated states.
- Start/execute button renders staged results or error/timeout states.

## Ant Select / Layout Obstruction

Marketing workbench pages often use Ant Design Select for the site field. Test it with Playwright, but do not rely on one center click:

- Capture the select bounding box and `elementFromPoint` at center/right edge.
- If the sidebar intercepts the center click, try the selector's visible right edge before declaring the site unselectable.
- Save the attempted methods and option texts in the audit JSON.
- If the control is partly hidden by the sidebar, mark the layout/usability item fail even if a right-edge or force-click path can continue the query.
- Query-result criteria should be based on the best normal user-operable path available; if only forced/programmatic selection works, separate that diagnostic result from the product verdict.

## Sidebar Check

Do not rely only on button text. Some collapsed states replace "收起侧栏" with an icon. Measure the sidebar element:

- before width around full sidebar size
- after width materially smaller, e.g. delta at least `40px`
- class/text changes, such as `collapsed`

## Scope Discipline

Score each point on the outcome the judge requires, not on a particular implementation of it.

- A capability rendered unclickable or disabled already satisfies "does not start a query and does not submit a form". Do not require an extra toast or hint text for that outcome. The separate points that ask for a visible `功能待开放` message are still judged on their own.

## Layout Obstruction Outweighs Style Polish

Measure the sidebar against the main work area rather than judging the shell on style alone.

- When navigation is oversized enough to crowd, overlap, or obstruct the primary operating region — including the leftmost input of the main page — treat it as a usability defect.
- That defect outweighs general visual polish in the enterprise-style comparison, so the page ranks below a baseline that keeps the work area clear. Support the verdict with sidebar width, the obscured element, and the screenshot.
- For the `pairwise_gsb` enterprise-style task, feed this defect into the **GSB Decision Ladder** rather than concluding directly: an obstruction present on one side only is a Step 2 critical defect (tested-only → B, benchmark-only → G); when both sides share it or neither has it, continue to Step 3 and compare aesthetic achievement. A merely wide sidebar that does not actually impede the work area is not a critical defect. The verdict must come from this round's own evidence — never from a pre-supplied label.

## Reporting

Use screenshots plus DOM metrics for layout interactions. Treat missing required enabled/disabled states as fail. For visual quality, make a model-judged verdict from screenshots and layout metrics first; use `fail` only when the relevant visual evidence is insufficient.

For main-page layout/component completeness, judge directly from the screenshot first, then support the verdict with DOM metrics such as sidebar width, visible tool entries, active panel text, and form/control counts. Do not leave layout or enterprise-style criteria unresolved when the screenshot clearly supports a pass/fail decision.

## Alignment-Focused Adjudication

Judge requested layout from functional region separation rather than a single overlap metric: identify navigation and conversation/content regions, verify both remain usable, and record any obstruction separately under criteria that require clean layout. A disabled future entry needs both non-actionability and a visible unavailable/pending-open meaning; gray color alone is insufficient. For streaming completion, wait beyond the final scheduled event and inspect the final summary, progress/state indicator, and disabled/enabled controls. Accept an unambiguous terminal state expressed structurally or visually even when the literal word “completed” is absent; do not accept a summary card that remains in a loading/intermediate state.
