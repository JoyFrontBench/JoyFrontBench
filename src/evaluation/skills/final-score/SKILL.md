---
name: final-score-skill
description: 从审计后的结构化判定计算 ATS、CTPR、ASR 和八维能力分数，并按 harness 分别输出模型排名、各题指标和运行覆盖情况。
---

# JoyFrontBench 最终指标汇总

## 职责与入口

汇总 evaluator 判定和 Strict Judge 的证据审计结果，按照面向目标的验收契约确定性计算指标，按 ASR 排名。

统一入口：

```bash
node src/evaluation/scripts/cli.mjs score:final \
  --prompts data \
  --runs-root /path/to/evaluations/runs \
  --output-root /path/to/final-score \
  --expected-runs 3
```

Docker 与 npm 共用此入口。批量评测自动调用同一评分器。
实现分别位于 `scripts/lib/scoring.mjs`、`core-scoring.mjs` 和 `capability-scoring.mjs`。

## 输入与审计

- `dataset.json` 和每题 Judge JSON 提供权威 Task/criterion ID、文本和判定模式。
- `core-criteria-policy.json` 提供已审核的 `gating`、`should`、`quality` 等级。
  存储级别 `gating` 对应论文的必达判据（mandatory criterion）；至少含一条必达判据的 pointwise Task 是核心 Task。
  加载时核对题号、ID、模式、文本、等级推导和核心 Task 集合。
- `capability-dimensions.json` 为每个 Task 提供唯一的正式能力维度。
- 每次运行读取 `reports/eval-summary-results.json`、
  `reports/eval-judge-results-strict.json` 和可用的 `pipeline-state.json`。
- 批量 `batch-state.json` 保留已计划但未产出结果的运行身份。
- `runIdentity` 包含 harness、model、run ID；题号和 question ID 必须匹配题库。

所有正式分数使用同一套**审计后** Task/criterion 数值：

- 有效 pointwise `pass` 为 1，`fail` 为 0。
- 缺失、重复、错误、格式无效或无可接受证据的 criterion 为 0，保留权威分母。
- 局部审计问题只清零对应 criterion；Task 级问题清零该 Task。
- Pairwise 是一次 Task 级比较；任一相关契约或证据问题清零该次比较。
- 缺少审计、整条结构无效或无法定位的审计问题使整条运行按零计。
- 构建与运行的审计问题影响 ASR 的运行条件；其余判定按各自审计结果计分。

源码证据用于可独立从源码验证的要求；交互、状态变化和视觉要求使用相应的运行证据。

## 指标定义

固定模型与 harness，令题集为 Q，每题计划 R 次运行，默认 R=3。
每题 q 的全部 Task 为 T_q，核心 pointwise Task 为 C_q。
每个 criterion 的审计后数值记为 y，核心 Task 的必达判据集合记为 M；完成阈值为 τ=0.8，
由公开集选定并在测试集评测前固定。

### ATS — Average Task Score

Pointwise Task 得分为全部权威 criteria 的通过比例：

```text
A(q,r,t) = sum_j y(q,r,t,j) / criterion_count(q,t)
```

Pairwise 的 G/S/B 映射为 `1 / 0.5 / 0`，无效或缺失结论为 0。
每个 Task 计一次，pairwise 子项提供比较依据。
令 Z 为对应模式的 Task 得分：

```text
O(q,r) = sum_{t in T_q} Z(q,r,t) / |T_q|
```

### CTPR — Core Task Pass Rate

核心 Task 只有同时满足两个条件才通过：全部必达判据为 1，
且该 Task 全部 criteria 的通过比例达到完成阈值 τ=0.8。

```text
P(q,r,t) = all_{j in M(q,t)} y(q,r,t,j)=1 AND A(q,r,t)>=τ
C(q,r) = sum_{t in C_q} P(q,r,t) / |C_q|
```

阈值判定使用原始精度。非必达判据仍在完成率分母中。
缺少核心策略或核心 Task 定义时，CTPR/ASR 为 `null`。

### ASR — Application Success Rate

构建与运行通过记为 B=1，否则为 0：

```text
S(q,r) = B(q,r) * all_{t in C_q} P(q,r,t)
```

结果必须包含：

```json
{
  "buildAndRuntime": {
    "status": "passed",
    "reason": "实际构建、启动和浏览器访问的结果说明",
    "evidence": ["/output/data/runtime-check.json"]
  }
}
```

`status` 为 `passed`、`failed` 或 `unverified`，由本轮执行日志支持。
静态作品验证页面可访问并正常运行。

验收要求同一次运行的同一份作品通过全部核心 Task。作品 build/runtime 失败使 B=0，
但独立有效的源码项仍参与 ATS 与 CTPR。
基础设施错误重试后仍未解决的运行按零计入计划分母。

### 三项主指标的汇总

```text
Avg(x) = sum_{q in Q} (sum_{r=1..R} x(q,r) / R) / |Q|
ATS  = Avg(O)
CTPR = Avg(C)
ASR  = Avg(S)
```

先对每题的计划轮次平均，再对题目宏平均。
例如 R=3、一次成功运行的题目 ASR 为 1/3。

### Capability Scores — 八维能力分数

对维度 d 中的所有 `(question, task)` 对构成的集合 U_d：

```text
CapabilityScore(d) = sum_{(q,t) in U_d} (sum_{r=1..R} Z(q,r,t) / R) / |U_d|
```

复用 ATS 的审计后 Z，先按 Task 的计划轮次平均，再对同维度 Task 等权。
八维分别报告。无所属 Task 的维度为 `null`；缺失标签时标为不可用。

| 标签 | 英文名称 | 缩写 |
| --- | --- | --- |
| 组件完备 | Component Completeness | CC |
| 表征保真 | Representation Fidelity | RF |
| 视觉品质 | Visual Quality | VQ |
| 交互响应 | Interaction Responsiveness | IR |
| 计算渲染 | Computational Rendering | CR |
| 规则仿真 | Rule Simulation | RS |
| 状态管理 | State Management | SM |
| 数据交换 | Data Exchange | DE |

## 运行矩阵与比较范围

- `--expected-runs` 是固定计划分母，默认 3；一次运行可设为 1，对比时使用相同计划次数。
- 缺失运行、缺失题目或整条不可评分的记录按零保留。
- 相同 harness/model/question/run ID 的重复记录占一个零分槽位。
- 超过计划轮次报错。
- 不同 harness 分开排名。公开 reference 为正式范围，custom reference 仅为实验范围。
- 同一汇总使用一致的 reference 集合与比较协议。

## 输出契约

生成 `final-score.json`、`final-score.md` 和 `scoring-input-manifest.json`。

JSON 的 `scoring_policy.primary_metric` 固定为 `asr`，`scoring_policy.metrics` 使用
`ats`、`ctpr`、`asr`、`capability_scores`；阈值为 `scoring_policy.completion_threshold`。
`leaderboards.official[harness]` 和 `leaderboards.experimental[harness]` 的模型条目含：

- `ats`、`ctpr`、`asr`：0 到 1 的未舍入值；不可用为 `null`。
- `ats_percent`、`ctpr_percent`、`asr_percent`：对应百分制值。
- `question_scores`：各题同名指标、计划/观察/有效运行数。
- `rank`：仅按 ASR 排名，ASR 不可用时为 `null`。
- `dimension_scores`：八维能力分数，含英文名、缩写、中文标签和覆盖情况。

八维还位于 `capability_dimensions.dimension_scores[harness]`，其 `metric` 为 `capability_scores`。
`run_details` 保留每次运行的审计后 Task 分数、核心 Task 判定、构建与运行结果和三项指标。
为兼容既有下游解析，数值字段 `ors` 与 `tsr` 分别保留为 `ats` 与 `asr` 的别名；
`scoring_policy.d_ors` 和 `scoring_policy.tsr_rule` 也保留旧字段名，但展示报告仅使用论文术语。

所有均值和排名先用未舍入值计算，Markdown 最后显示两位小数的百分数。
同分按未舍入的 ASR 判定，使用相同排名。
