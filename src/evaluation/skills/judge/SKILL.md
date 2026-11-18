---
name: web-page-eval-judge
description: Judge and audit completed web-page evaluation results for coverage gaps, lazy evidence reuse, missing criterion checks, unsupported pass verdicts, repeated screenshots, stale network failures, and report integrity before accepting an automated evaluation run.
---

# Web Page Eval Judge

Use this after a web-page evaluation run and before reporting results as final. The judge's job is to find what the evaluator missed, not to restate the evaluator's conclusions.

Default loop:

1. Run the evaluator.
2. Run the judge audit on the produced `eval-summary-results.json` and reports.
3. Treat judge issues as a todo list.
4. Add missing targeted checks or mark unsupported conclusions as `fail`.
5. Rerun the affected task(s), then rerun the judge.
6. Only summarize final results after the judge has no high-severity integrity issues, or clearly list the remaining gaps.

Global audit principle: accept the strongest available evidence in this order: deterministic source/DOM/data/state/download/runtime evidence first, minimal necessary interaction plus deterministic assertions second, and `criteria` reference interaction steps / screenshot-model judgment when the criterion cannot be proven otherwise. Do not require a reference interaction path when source code, DOM, exported data, localStorage, runtime debug state, or pixel/time-series evidence already fully proves the same validation point. Do require interaction or an equivalent runtime proof when the criterion itself is about user action, flow completion, animation response, or before/after state change. Crucially, source-level existence of geometry, drawing code, formulas, particle objects, or internal/velocity state samples does not by itself prove runtime observability: when a criterion is about an observable form or appearance and the screenshots or frame sequence show the target unrecognizable, too dark, all-black, occluded (black bar/panel), or simply absent, mark that point `fail` rather than passing from object sampling or source presence. Before judging an observable feature, first perform whatever zoom (wheel out to see the whole body), view rotation, view switch, or full-cycle/complete-morph wait is needed to see the complete form, so a point is not misjudged from an incomplete framing.

## Hard No-Laziness Rules

These are audit failures:

- 明确禁止“偷懒式评测”：没有逐条跑就不要写成已通过，没有独立证据就不要写成独立测试，没有复核 `criteria` 子项就不要说覆盖完整。
- `criteria` 条目和验证点必须一一对应：`criteria` 第 1 条就是验证点 1，第 2 条就是验证点 2，依此类推。审计不得重排、合并、漏掉或自造验证点。
- 对每一个验证点，都必须参考它在同一条 `criteria` 中给出的交互步骤、参考流程、前置准备、输入值、按钮名、筛选项、模拟开关、导入/导出文件等信息来理解验证语义；不能只读取验证点结论文本而忽略其中的交互上下文。
- “交互步骤/参考交互过程”是对应验证点的参考执行路线和必要上下文，不能作为无关文本简单丢弃。审计时要确认 evaluator 是否提供了完整的确定性证据，或按该验证点对应步骤执行，或执行了等价且可解释的替代路径。
- 如果某个验证点依赖其对应步骤中的特定前置状态，例如“重置模拟数据”“打开异常模拟”“输入 100005”“选择某模板”“执行发布”，报告必须有这些步骤或等价状态的证据；缺少则该验证点不能记为 `pass`。
- A `pass` verdict with no concrete evidence.
- A click/input action counted as pass without downstream DOM/data/download/state change.
- A screenshot-only pass for deterministic data requirements such as CSV parsing, JSON export, array length, filters, disabled state, or validation state.
- Task-level evidence copied into every criterion as if each one was independently tested.
- Auto-split criteria shown as passed without a dedicated assertion, interaction, data check, or concrete visual judgment.
- Human-facing report reasons containing internal fallback/mapping wording such as "对齐到已有自动化子项", "缺少该校验点的专项自动化证据", "原大项结论", or "父项综合结果".
- Reusing the same generic screenshot for unrelated criteria without a specific reason.
- Reporting "all buttons work" after clicking only one or two buttons.
- Reporting visual quality as pass without screenshot/crop evidence, model-judged visual rationale, or objective layout checks.
- Overwriting a previous valid report with a transient `blocked/network` result.
- Missing selected questions or tasks from the authoritative dataset/Judge JSON.
- Hard-coding task counts or inferring criteria from prose instead of reading JSON arrays and explicit IDs.
- 追加 `criteria` 未明示的标准。先区分结果要求与实现示例，并接受能产生相同可观察语义的替代实现；例如不要自加最小字号、指定 API、额外标签或筛选级联。对数值精度、响应式和类似边界，依据题面语义选择能直接验证结果的数据或布局测量。
- 用源码中的处理函数、控件定义或状态变量代替运行态验证。交互项应记录动作前状态、实际动作、即时反馈和下游状态；若控件无响应、缺失或不可到达，理由应准确描述已执行路径及观察结果。
- 只验证控件存在而不验证调节范围与业务效果。对参数、reset、读数和提示类要求，应使用边界值或代表值并比较相关视觉、数据和状态变化；实现代码仅用于解释观察结果。
- 用单个随机样本证明确定性状态机。根据风险使用固定 seed、多个 seed 或边界场景复现，检查互斥状态、运行时稳定性和所有依赖视图是否保持一致。
- 用物理量映射代码证明连续或合理的视觉表现。同步采样驱动值与渲染帧，观察过渡、接触、支撑和因果关系，并根据题面要求区分数值正确、连续可见和物理可信这三类结论。

These checks describe evidence methods rather than preset outcomes. Apply them to the current run independently and derive every verdict from the observed criterion-specific evidence.

## Validation Point and Interaction-Step Traceability

Audit every requirement with a traceability matrix. The judge should be able to answer all of these for each leaf item:

| Field | Audit expectation |
| --- | --- |
| `question_id` / `task_id` | The current dataset question and Judge task are present in the result. |
| `criterion_id` | The row preserves the explicit JSON ID and the order of `criteria[]`; it is not inferred from text or validation-step numbers. |
| `criteria` 验证点 | The exact Nth acceptance point from `criteria` is preserved; no validation point is dropped, merged away, reordered, split into unrelated rows, or replaced by a vague abstraction. |
| 参考交互步骤 | Relevant `instructions` and `validation.steps` are matched to the criterion by meaning, including setup actions, input values, buttons, modes, filters, uploads/downloads, and expected end states. |
| 证据路线 | The report states or implies which route was used: direct deterministic proof, minimal interaction plus deterministic assertion, or the reference/equivalent interaction path. |
| 实际执行动作 | If interaction is needed, the report/evidence shows those steps were executed or explains an equivalent path. If interaction is not needed, the report/evidence explains why source/DOM/data/state proof is sufficient. A generic page screenshot is not enough. |
| 结果断言 | There is an observable downstream result: DOM/state/data/download/localStorage change, validation error, disabled/enabled state, route/state transition, screenshot sequence, or model-judged visual observation. |
| 结论 | For pointwise, `pass` requires complete deterministic evidence or the required/equivalent interaction path plus downstream assertion; otherwise use `fail`, `blocked/network` or `error` with a criterion-specific reason. Pairwise criteria contain observations only; audit G/S/B once at task level. |

Rules for using interaction steps:

- Do not score interaction steps as extra independent validation points when they only describe how to exercise the corresponding `criteria` item; use them to understand the intended setup/actions and to decide whether validation point N is already covered by deterministic evidence or needs an interaction path.
- Do not create a criterion from `instructions` or `validation.steps`. Match each relevant step to the explicit criterion by meaning, not by coincidental numbering.
- Do not merge, split or renumber `criteria[]` objects. The report and audit must preserve their explicit IDs and source order.
- If one interaction proves multiple validation points, shared evidence is acceptable, but each row's reason must name the concrete step/result that proves that specific point.
- If a validation point is present but the necessary step was not attempted and there is no equivalent deterministic proof, flag any `pass` as high severity. If deterministic evidence fully proves the point, do not flag it merely for not following reference steps. If it is honestly marked `fail` with a precise “未执行/未覆盖该步骤” reason, it may be medium or pass the integrity audit depending on strictness.
- For business flows, verify setup and progression steps, not only the final page. Example: if `criteria` says to reset simulation data, enable an exception, enter a tenant id, select a template, validate, preview, and publish, the evidence should show each required phase or explain why the phase could not be reached.
- For upload/download/data flows, verify both the UI action and exported/imported data. Example: selecting a filter is not enough; the exported JSON or visible result must reflect the filter.
- For visual/animation flows, verify the specified interaction path with frame sequences/crops/state samples when the validation point depends on motion, not only a static final screenshot.

## Required Judge Checks

For each run, verify:

- Build/runtime result: audit `buildAndRuntime.status`, `reason`, and current execution logs. Both `passed` and `failed` are valid documented outcomes; use `scope: runtime` for issues with this result.
- Dataset coverage: every selected question and every Judge task/criterion appears in the summary and per-question report.
- Requirement coverage: each requirement has a status, reason, and appropriate evidence.
- `criteria` coverage: each parsed criterion has its own status, concrete reason, and appropriate evidence.
- One-to-one numbering: validation point N must correspond to the Nth `criteria` item; missing, reordered, merged, or invented validation points are audit failures.
- Evidence-route coverage: for each criterion, the judge can trace whether it was proven by deterministic source/DOM/data/state evidence, by minimal interaction plus downstream assertion, or by the referenced/equivalent validation protocol and visual/runtime evidence.
- Evidence integrity: every linked screenshot/file exists, and Markdown uses relative paths that Typora can render.
- Evidence specificity: repeated evidence across criteria is acceptable only when the same interaction truly proves multiple checks; otherwise flag it.
- Deterministic claims: `pass` on data/DOM/export behavior must cite machine-readable evidence such as JSON, DOM audit, localStorage, or before/after state.
- Visual claims: subjective visual terms should receive a model-judged verdict from screenshots/crops/frame evidence first. Flag definitive pass only when it lacks visual evidence or concrete visual rationale.
- Network handling: network errors should be `blocked/network`; they should not erase a previous non-network report.
- Report freshness: report paths and timestamps should match the latest run or be explicitly marked as preserved.

## Severity

- `high`: the reported result is misleading or unsupported, such as missing Judge tasks, unsupported pass, missing evidence file, task-level evidence copied into unrelated child pass rows, or internal fallback wording in the human report.
- `medium`: the result is incomplete but honestly marked, such as `fail` because the required screenshot/frame/data evidence is missing.
- `low`: readability issue, excessive evidence, repeated but relevant screenshots, or wording that could be clearer.

## Expected Output

The judge should produce a separate Markdown report, for example:

```text
eval-output/reports/eval-judge-report.md
```

It should include:

- overall judge status: `pass`, `needs-followup`, or `invalid`
- high/medium/low issue counts
- per-question issue table
- concrete next actions, such as "add subtest for web1 task 6.1" or "rerun frontenjoyai-001 after adding DOM assertion"

Do not hide medium issues. If many criteria are marked `fail`, say whether they lack visual evidence, deterministic subtests, or source/provenance review, then propose targeted follow-up tests.

## Command

From the repo root:

```bash
npm run judge
```

Use filters for targeted review:

```bash
npm run judge -- --id=frontenjoyai-001
npm run judge -- --id=web1 --strict
```

Use `--strict` when deciding whether results are ready to present. In strict mode, any auto-split child criterion without an independent subtest is a high-severity issue.

Strict mode writes separate artifacts so it does not overwrite the normal judge report:

```text
eval-output/reports/eval-judge-report-strict.md
eval-output/reports/eval-judge-results-strict.json
```
