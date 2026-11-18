---
name: frontend-eval-pipeline
description: 串联前端页面评测、单一题型专项规则、评测报告生成和 Strict Judge 复查；用于从零评测指定 workspace 或批量 run，并在审计发现问题后按受影响的 criterion 定向补测、补证据、重写报告和再次审计。
---

# 前端评测主流程编排

你是前端自动评测流水线的主编排代理，按固定顺序调用下游 Skill、维护阶段状态，并根据 Strict Judge 意见安排定向补测。

本 Skill 当前只覆盖：

```text
页面评测
  → 对应题型专项评测
  → 生成评测报告
  → Strict Judge 复查
  → 定向补测 / 补证据 / 修正报告
  → 再次 Strict Judge
  → 可交付评测结果
```

单题流程负责判定、证据采集和审计。批处理结束后由
`scripts/lib/scoring.mjs` 自动读取题库的 `capability-dimensions.json`，
汇总 ATS、CTPR、ASR 和八维能力分数；已有结果也可用 `score:final` 重算。

---

## 一、必须加载的 Skill

每道题必须按以下顺序读取并遵守：

1. 通用页面评测规则：
   `src/evaluation/skills/page-evaluation/SKILL.md`
2. 与该题匹配的**唯一一个**题型专项 Skill：
   `src/evaluation/skills/page-evaluation/topics/<topic>/SKILL.md`
3. 报告生成规则：
   `src/evaluation/skills/report-generation/SKILL.md`
4. 评测完成后读取 Strict Judge 规则：
   `src/evaluation/skills/judge/SKILL.md`

通用 Skill 规定浏览器、证据和判定总原则；专项 Skill 规定该题型的稳定锚点、交互路径、领域不变量和高风险误判；报告 Skill 规定输出结构；Judge Skill 只负责复查覆盖和证据完整性。

### 1.1 专项 Skill 选择

专项 Skill 根据题目 `id`、Judge 文本和 profile 选择：

- 当前 30 题优先使用 `skills/page-evaluation/SKILL.md` 中的映射表；
- 程序化选择时，以 `src/evaluation/scripts/lib/tasks.mjs` 的 `detectProfile()` 结果为准；
- 当前题库中的已知题不得退化为 `generic`；
- 每道题只加载一个主专项 Skill，避免多个专项规则相互冲突；
- `skills/report-generation/` 和 `skills/judge/` 是独立的流程 Skill，不计入“一个专项 Skill”的限制。

若题目确实没有已知专项 Skill，才允许只使用通用页面评测规则，并在流水线诊断中记录 `missing_topic_skill`。

---

## 二、输入契约

每个评测单元必须明确以下输入：

- `workspace`：唯一被测作品目录，只读；
- `prompts_root`：包含 `dataset.json`、`tasks/` 和 `judge/` 的题库目录；
- `question_no` 和 `question_id`；
- `output_root`：本次新评测的独立输出目录；
- `benchmark_workspace`：仅当该题存在 `pairwise_gsb` task 时提供；
- `run_identity`：至少包含 harness、model、question、run_id；直目录评测可使用显式传入的固定值。

### 2.1 Benchmark 定位规则

先解析当前题目的全部 `judge_mode`。只有存在 `pairwise_gsb` 时才定位 benchmark；纯 pointwise 题不得加载 benchmark。

按以下顺序解析：

1. 优先使用调用方显式传入的 `benchmark_workspace`；
2. 默认加载匹配题目和评分映射的 `data/references/manifest.json`，公开集只有 15 题的 `scenes.json` 与 PNG 画面，模式为 `visual`；
3. 没有匹配公开集时报告缺少标杆，不自动查找未指定的参考来源；
4. visual 模式直接读取 runner 复制到本轮 `screenshots/reference/<question_id>/` 的场景清单与画面，不得启动服务器、安装依赖、寻找源码或自行替换参考图；
5. 显式指定的自定义参考应用采用 `live-workspace` 协议，启动顺序为已有 `dist`、dev server、独立 HTML。不同协议的结果不可混合计分。

解析后必须验证：

- visual 模式的全部参考 PNG 及场景清单存在、格式正确且可读取；仅 live 模式要求 benchmark 可以启动；
- benchmark 与被测 workspace 不是同一路径或同一文件；
- 被测侧匹配场景清单的 viewport、locale、timezone、reduced_motion、等价初始状态和语义操作，并在可比较的时刻采样；不强制相同 DOM、URL、布局或像素；
- 最终解析路径写入 `pipeline-state.json` 和 pairwise evidence。
- 参考集、题目和比较协议由 runner 写入结果；不同参考口径不得混合汇总，custom 仅用于实验榜。
- 不得修改或美化冻结参考图。被测作品及自定义参考应用的安装/构建只能在独立临时副本中执行。

若存在多个候选、入口缺失或无法确认配对关系，将该 `pairwise_gsb` task 标记为 `blocked` 并记录 `benchmark_unresolved`；不得从 pointwise 结果推测 G/S/B。

### 2.2 新鲜运行原则

当用户要求“重新评测”“从零评测”或传入 `fresh=true` 时：

- 只读取被测 `workspace`、题库和必要的 benchmark；
- 不读取旧 `eval-summary-results.json`、旧截图、旧 evidence、旧 partial 或旧 verdict；
- 唯一例外：runner 校验后复制的公开冻结参考画面是本轮评分输入，允许读取，必须标明冻结来源；不能把它们声称为本轮启动标杆得到的截图；
- 不使用旧报告补齐本轮缺失证据；
- 所有截图、DOM/JSON、下载文件、运行日志和判定必须写入新的 `output_root`；
- 可以使用镜像内依赖缓存或重新构建出的 `dist`，但不得把旧评测结论当作输入。

若采用构建缓存，必须将缓存保存的源码与当前源码逐文件比较，并在运行元数据中记录构建来源和比较结果。构建缓存不是评测证据。

---

## 三、阶段状态机

每个评测单元使用以下状态：

```text
pending
  → preparing
  → evaluating
  → reporting
  → auditing
  → remediating（仅 Judge 未通过时）
  → reporting
  → auditing
  → ready | needs-followup | invalid | blocked
```

不得跳过 `reporting` 直接运行 Judge，也不得在没有重新生成报告的情况下声称 Judge 问题已修复。

注意区分两个层级的状态，二者名称相近但含义不同：

- **评测单元级**：`ready` / `needs-followup` / `invalid` / `blocked`，描述整个评测单元的交付状态，由 Strict Judge 结果决定；
- **task 级**：`completed` / `blocked` / `needs_review`，描述单个 task 的判定结果。其中 `needs_review` 只用于 pairwise task 按 GSB Decision Ladder 第 5 步无法定出 G/S/B 的情形（高优维度无法排序或证据不足）。

一个评测单元可以是 `ready`，同时其中某个 pairwise task 是 `needs_review`——前者说明报告覆盖与证据合规，后者说明该 task 的相对结论待定，由最终评分按异常口径处理。不得为了让单元达到 `ready` 而把 `needs_review` 改写成 S。

建议在输出根写入 `pipeline-state.json`，至少包含：

- 当前阶段和更新时间；
- workspace、题目和 run identity；
- 已加载的四类 Skill 路径；
- 每轮评测与审计的开始/结束时间；
- Strict Judge 状态和 high/medium/low 数量；
- 已执行的 remediation 轮次；
- 最终状态及未解决问题。

---

## 四、阶段 A：页面与专项评测

### 4.1 启动作品

按通用页面评测规则发现目标：

1. 优先当前 workspace 自带的 `dist`；
2. 其次启动项目 dev server；
3. 再其次使用根目录独立 HTML；
4. 都不存在时标记 `unlaunchable`，不得猜测页面行为。

启动和构建不得修改被测源码。需要生成临时构建产物时，应复制到本轮输出或临时工作区。

### 4.2 读取权威 Judge

只以 `prompts_root/dataset.json` 和对应 `judge/<题号>-<id>.json` 为权威定义。

对 Judge JSON 的 `tasks[]` 中每个顶层 task：

- 读取 `task_id`、`judge_mode`、`task` 和 `criteria`；
- 直接读取 `criteria[]` 的 `criterion_id` 和 `text`，保持数组顺序与显式 ID；
- 每个数组元素对应一个 `criterionResult`，不得按文字编号、分号或 Markdown 再次拆分；
- `instructions` 是附加判定上下文，`validation.description` 与有序 `validation.steps` 是验证规程；必须读取，但不增加判分单元；
- 不增加 Judge 未要求的验收标准。

流水线 context 中的 `criteria` 是上述 `text` 的数组，`criterionIds` 与它逐项对应；`criteriaText` 仅为派生展示文本，不是解析或重新编号的来源。历史结果按题目 `id` 对齐，不依赖 Excel 行号；兼容输出字段 `row` 使用公开题号。

### 4.3 执行评测

先应用通用页面评测策略，再应用该题的专项 Skill：

- 确定性行为优先使用 DOM、下载文件、JSON、localStorage、源码结构和前后状态断言；
- 主观视觉、构图、材质、光照和美观项必须使用本轮截图交给视觉模型判定；
- 动画、游戏、Canvas、3D、拖拽和连续状态必须采集序列帧或机器可读时间序列；
- 交互项必须真正执行点击、输入、拖拽、滚动、键盘或上传下载流程；
- 不得因为源码存在某段实现就直接判定运行态通过；
- 不得因为页面看起来合理就推测数据、持久化或状态机通过。

### 4.4 Judge Mode

#### Pointwise

- 每个叶子验证点独立输出 `pass`、`fail`、`blocked/network` 或 `error`；
- 每项必须有具体 reason 和本轮 evidence；
- 父 task 状态只作为叶子结果汇总，不重复计分或替代叶子判定。

#### Pairwise GSB

- 只有 `judge_mode=pairwise_gsb` 才读取参考画面；公开 visual 模式只运行被测作品，不运行 benchmark；
- 匹配场景清单中的 viewport、初始状态和语义操作；视觉比较不是像素相似度或对标杆布局的模仿；
- completed 必须覆盖该 task 的全部参考场景和序列帧，`comparison_meta` 记录 `reference_protocol` 与 `reference_scene_ids`，benchmark evidence 引用本轮复制的 PNG；
- 有限帧不能证明动画任意时刻、性能、源码约束、数据一致性或原创授权。缺失状态或不可观察要求影响高优维度判定时，使用 `needs_review`，不得擅自删除 rubric 中的要求；
- 判定必须按 `skills/page-evaluation/SKILL.md` 的 **GSB Decision Ladder** 逐步执行：可比性前置 → 确定高优维度 → 关键缺陷一票否决 → 高优维度定胜负 → S 的收紧定义 → 兜底 `needs_review`；
- 每个 completed pairwise task **有且仅有一个** task 级 G/S/B；`blocked` / `needs_review` 时必须 `gsb=null`；各 criterion 只提供比较维度和证据，不单独出 G/S/B，也不按 criterion 数量计票；
- 输出 `G`、`S` 或 `B`，并给出 1–2 条具体相对差异 `reason` 与**双侧**证据；
- 高优维度无法排序或证据不足时输出 `needs_review` + `gsb=null`，不得强行判 S；
- 不得从 pointwise 的 pass/fail 猜测 G/S/B；
- 不得使用预设 G/S/B；判定仅来自本轮被测证据与明确标识的冻结参考画面；
- benchmark 不单独出分，也不影响同题 pointwise task。

pairwise task 必须落盘以下结构：

```json
{
  "status": "completed | blocked | needs_review",
  "gsb": "G | S | B | null",
  "reason": ["1–2 条支持当前结论的具体相对差异"],
  "evidence": { "tested": ["..."], "benchmark": ["..."] },
  "comparison_meta": {
    "viewport": "1440x900",
    "interaction_path": ["..."],
    "sampled_at": "...",
    "high_priority_dimensions": ["..."]
  }
}
```

`evidence` 必须按被测侧与 benchmark 侧分列，`reason` 必须说明结论对应的具体相对差异；`comparison_meta` 必须记录实际使用的 viewport、操作路径、采样时机和所选高优维度，供后续审计核对两侧是否真正可比。被测与 benchmark 的 workspace/本地产物定位属于评测单元级运行信息，统一记录在 `pipeline-state.json`，不在每个 pairwise task 中重复保存 URL 或 entry 字段。

### 4.5 原始结果

评测阶段必须生成 Strict Judge 可消费的结构化结果，默认路径：

```text
<output_root>/reports/eval-summary-results.json
```

每道题至少包含：

- id、row、number、profile、URL 和 run identity；
- `buildAndRuntime`：`status` 为 `passed`、`failed` 或 `unverified`，`reason` 说明构建、启动和浏览器访问结果，`evidence` 列出本轮执行日志；静态作品验证浏览器访问和运行结果；
- 原始 requirements；
- 与 requirements 一一对应的 `requirementResults`；
- 每个顶层 task 的 status、reason、evidence 和 `criterionResults`；
- pairwise task 的 G/S/B 原始结论，含 `status`、`gsb`、`reason`、双侧 `evidence` 与 `comparison_meta`（见 4.4）；
- 页面错误、截图列表和报告路径。

---

## 五、阶段 B：生成评测报告

所有 verdict 和 evidence 落盘后，读取并遵守：

```text
src/evaluation/skills/report-generation/SKILL.md
```

必须输出：

```text
<output_root>/reports/eval-summary-results.json
<output_root>/reports/md/<row>-<id>-report.md
<output_root>/reports/html/<row>-<id>-report.html
<output_root>/reports/md/eval-summary-report.md
<output_root>/reports/html/eval-summary-report.html
```

报告要求：

- 评分表以单条 criterion 为最小行；
- 每行有最终状态、具体理由和对应 evidence；
- JSON evidence 既有文件链接，也有可读预览；
- 多张截图应分行展示，不挤在同一证据单元格；
- 所有链接使用可移植相对路径；
- 报告不得出现内部占位词、自动拆分话术或未验证却判通过的描述。

生成报告后，先自行检查所有链接和证据文件存在，再进入 Strict Judge。

---

## 六、阶段 C：Strict Judge 复查

读取并遵守：

```text
src/evaluation/skills/judge/SKILL.md
```

运行严格审计：

```bash
npm run judge:strict -- \
  --prompts=<prompts_root> \
  --results=<output_root>/reports/eval-summary-results.json \
  --report-root=<output_root>/reports
```

Strict Judge 输出：

```text
<output_root>/reports/eval-judge-results-strict.json
<output_root>/reports/md/eval-judge-report-strict.md
<output_root>/reports/html/eval-judge-report-strict.html
```

Strict Judge 只审计：

- task 和 criteria 是否完整覆盖；
- 编号和叶子结果是否一一对应；
- pass/fail 是否有可追溯证据；
- 确定性结论是否有机器可读证据；
- 动态视觉结论是否有序列证据；
- 是否偷懒复用无关截图；
- evidence 和报告链接是否存在；
- 报告是否使用旧结果、占位理由或误导性结论。

Strict Judge **不拥有功能判定权**，不得直接把 `pass` 改成 `fail`、把 `fail` 改成 `pass` 或生成 G/S/B。功能 verdict 仍由评测阶段根据新证据决定。

---

## 七、阶段 D：Judge 意见修正闭环

是的，Strict Judge 之后必须有修正步骤；但修正含义是“回到受影响的评测点重新验证”，不是按 Judge 文本直接改答案。

### 7.1 问题到动作的映射

| Judge 问题 | 正确修正动作 |
| --- | --- |
| 缺少 criterion 结果 | 回到 Judge 定义，补齐对应 `criterionResult`，并实际执行该验证点 |
| pass 无证据或证据不支持 | 重新执行验证并采集证据；若新证据不能证明通过，评测器将其改为 fail |
| fail 只有泛化理由 | 执行或补充最接近的验证，写出与该验证点直接相关的具体失败原因 |
| 确定性结论只有截图 | 增加 DOM、JSON、下载文件、localStorage、源码或状态差异证据 |
| 动态结论只有单帧 | 增加交互前后截图、序列帧、视频帧摘要或时间序列状态 |
| 多个子项偷懒复用截图 | 为各子项补充专项证据；确属同一证据时分别解释它如何证明该子项 |
| evidence 路径缺失 | 重新生成文件或移除无效引用并重新评测，禁止伪造空文件 |
| 报告编号/链接/排版错误 | 修复结果映射并重新运行 report-generation |
| 旧网络失败覆盖新结果 | 重新运行当前评测；网络问题仍存在时诚实标记 blocked/network |
| 题型规则使用错误 | 重新选择正确专项 Skill，并重跑受影响 task |

### 7.2 修正原则

- 只重跑受影响的题目、task 或 criterion，除非 Judge 指出系统性错误；
- 新 verdict 必须来自新执行或新证据，不得只改 JSON 文本；
- 保留原始结果和每轮 Judge 报告，形成可审计历史；
- 修正后重新生成该题 Markdown、HTML 和汇总 JSON；
- 报告重写后必须再次运行 Strict Judge；
- 不得为了让 Judge 通过而删除真实失败、降低验证标准或隐藏异常。

建议每轮写入：

```text
<output_root>/remediation/round-01/
<output_root>/remediation/round-02/
<output_root>/remediation/round-03/
```

其中保存该轮 Judge 问题快照、重跑清单、变更的 verdict/evidence 和执行日志。

### 7.3 退出条件

默认最多执行 3 轮 remediation，避免无限循环。

成功条件：

```text
strict judge status = pass
high = 0
medium = 0
```

退出状态：

- `ready`：Strict Judge 通过，可以交付；
- `needs-followup`：没有误导性 high 问题，但仍存在诚实记录的 medium 问题；
- `invalid`：仍存在 high 问题，当前评测不得作为有效结果；
- `blocked`：作品、benchmark、浏览器或必要 fixture 无法启动/获取。

达到轮次上限后仍未通过时，必须保留 Judge 报告和未解决问题，不得声称流程成功。

---

## 八、批量评测隔离

批量处理多个题目或多个 run 时：

- 每个 `harness + model + question + run_id` 使用独立评测单元；
- 每个评测单元使用独立浏览器上下文、输出目录和 Codex 会话；
- 不把上一题的页面状态、截图、判定或上下文带入下一题；
- benchmark 只挂载给当前存在 pairwise task 的题目；
- 并发调度不得让多个任务写入同一 reports/evidence 目录；
- 批量汇总只报告各评测单元的 pipeline 状态，本 Skill 不计算最终分数。

---

## 九、最终交付

本流程完成后只交付以下内容：

1. 本轮全新 `eval-summary-results.json`；
2. 每题 Markdown/HTML 评测报告；
3. 汇总 Markdown/HTML 报告；
4. Strict Judge JSON/Markdown/HTML；
5. remediation 历史；
6. `pipeline-state.json` 和未解决问题清单。

最终回复必须明确：

- 被测 workspace 和题目范围；
- 实际加载的题型专项 Skill；
- Strict Judge 最终状态与 high/medium/low 数量；
- remediation 轮数；
- 输出路径；
- 当前结果是 `ready`、`needs-followup`、`invalid` 还是 `blocked`。

不要在本阶段输出能力维度分数、题目分数、模型总分或排行榜。

---

## 十、流程自检

交付前逐项确认：

- [ ] 已读取通用页面评测 Skill；
- [ ] 每题只选择一个正确的专项 Skill；
- [ ] 已按 `criteria` 中的原编号逐项执行并记录证据；
- [ ] pointwise 与 pairwise_gsb 没有混用；
- [ ] 每个 completed pairwise task 按 GSB Decision Ladder 判定且只有一个 task 级 GSB；异常状态为 `gsb=null`；已落盘 reason、双侧 evidence 与 comparison_meta；
- [ ] 所有证据均来自本轮输出；
- [ ] 已生成 JSON、Markdown 和 HTML 评测报告；
- [ ] 已运行 Strict Judge；
- [ ] Judge 问题通过定向补测处理，而不是直接改 verdict；
- [ ] 每次修正后均重新生成报告并再次 Judge；
- [ ] 最终状态与未解决问题已如实记录；
- [ ] 未在本阶段计算能力维度或最终评分。
