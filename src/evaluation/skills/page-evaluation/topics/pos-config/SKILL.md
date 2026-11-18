---
name: pos-config-eval
description: Evaluate POS business configuration center pages, including task list search/filter, new/edit onboarding flows, template selection, disabled templates, validation errors, config edit/restore, draft save, publish simulation, and enterprise admin style screenshots.
---

# POS Config Eval Skill

Use this skill for "POS 业务配置中心" tasks and similar enterprise admin onboarding/configuration flows.

Default browser method: Playwright isolated Chrome. Capture screenshots at every major step: task list, search/filter result, template selection, config edit, validation/precheck, publish/draft result, and mobile/narrow viewport when style/responsiveness is judged.

## Strong Automated Checks

- Task list page loads with title/navigation/table.
- Search box exists and searching a known tenant such as `100001` changes visible rows.
- Status/scenario filters exist and can be opened/selected.
- "新建入驻" starts the wizard.
- Wizard steps are visible: tenant validation, business identity, source/template, config edit, precheck, publish, complete.
- Template cards exist for enabled standard templates such as 快餐、商超、便利店、专卖店.
- Disabled legacy template is visibly disabled and not selectable.
- Recommended tag appears where required; report exact count and labels.
- Config edit fields expose inherited/overridden states.
- Changing a config option changes coverage/error counters or field state.
- Restoring inheritance returns counters/state to the previous baseline.
- Validation failure shows specific error text and blocks next/publish action.
- Saving draft writes a visible result or localStorage draft entry.

## Interaction Patterns

- For React inputs, use native value setters and dispatch `input`/`change`.
- Prefer downstream assertions over click-only checks.
- For destructive publish flows, run in isolated browser storage. If publish mutates durable remote state, stop at simulation unless the user explicitly asks to publish.

## Reusable Checks

Use the caller-provided workspace and Judge JSON, never a fixed deployment or a previous model's results.

- Exercise search, the task table and configuration routes through the current page.
- For tenant validation, inspect the resulting workflow state and the exact actions required by the Judge.
- Audit template rows, recommendations and selection behavior against the current rubric.
- Click controls labeled disabled and try advancing; labels alone do not prove disabled behavior.
- For resume actions, compare the restored step and draft data with the task's required state.
- Evaluate visual quality from fresh screenshots rather than inherited verdicts.

## Reporting

Use `pass` for deterministic interactions and state checks. For visual style and polish, make a model-judged `pass`/`fail` from screenshots when evidence is sufficient; use `fail` only when the relevant visual evidence is missing or too limited. Include screenshot paths for each visited wizard state.

## Alignment-Focused Adjudication

Validation-and-repair criteria must be exercised as one uninterrupted user workflow from a fresh draft. Seed each stated failure class through the UI, run validation, return to editing, and inventory representative values before and after the round trip. Error localization requires the invalid field itself to be identifiable and reachable; a generic error count or automatically expanded section is only supporting evidence. After editing, observe whether field-level error state changes before or during revalidation as the criterion specifies, then complete the remaining publish steps and verify the home-page outcome. Do not combine observations from separate drafts or prove recovery only by inspecting implementation code.
