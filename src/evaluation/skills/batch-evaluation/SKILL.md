---
name: frontend-auto-eval
description: 通过统一评测入口启动 JoyFrontBench 批量评测，支持受限 Docker 并发、独立工作目录、进度查询和安全中断。
---

# JoyFrontBench 批量评测

## 启动

1. 使用调用方提供的隔离 worker 和 Docker daemon，不推断未指定的环境或路径。
2. 配置仓库 `.env`，确认评测模型与预算；正式评测会产生 API 费用。
3. 宿主机需要 Node.js >= 18.19。将 `WORKSPACE_ROOT`、`JOBS`、`HARNESS`、
   `MODEL` 和 `OUTPUT_ROOT` 设置为本次实验的路径、并发数及真实来源标签，
   在仓库根目录使用公开入口：

```bash
./src/evaluation/scripts/docker-run.sh eval:batch \
  --workspace-root="$WORKSPACE_ROOT" \
  --harness="$HARNESS" --model="$MODEL" \
  --jobs="$JOBS" --expected-runs=1 \
  --output-root="$OUTPUT_ROOT"
```

- 默认读取 `data` 与仓库自带参考图，reasoning 为 `high`。
- `--jobs` 范围为 1–32，默认 1。每个任务使用独立容器、Judge 状态目录和日志。
- 自动识别题目目录与生成 run 树；也可用 `--workspace-layout=questions` 或
  `--workspace-layout=run-tree` 显式指定。run 树保留来源 run ID，不重复生成。
- `--ids` 选择任务子集；`--expected-runs` 应与实验设计一致，默认值为 3。
- `--codex-model` 覆盖 Judge 模型；`--model` 只设置被测模型标签。
- 自定义参考集通过 `--benchmark-root` 指定，不自动查找未指定的参考来源。
- 输出目录必须为空。默认前台运行；需要后台运行时由调用方管理进程和日志，
  不使用另一套调度脚本。`--dry-run` 只准备评测输入，不调用模型或执行最终评分。
- 任务结束后自动执行最终评分，包含 ATS、CTPR、ASR 和八维能力分数。

## 查询与汇报

- 从 `<output-root>/batch-state.json` 的 `entries` 读取每项状态，
  不把 shell 启动成功当作评测完成。
- 工作日志位于 `<output-root>/orchestrator/logs/`。
- 任务产物位于 `<output-root>/runs/<run-id>/<question-id>/`。
- 结束后读取 `<output-root>/batch-summary.json` 与 `<output-root>/final-score/`。
- 汇报输出目录、运行中/完成/失败数量、最终评分状态和相关日志。

## 停止

前台使用 Ctrl-C；后台向本次调度进程发送 SIGTERM。
调度器停止本批次的命名容器，不再启动排队任务，记录取消状态并保留现有产物。
被中断的批次不执行最终评分；不要按模糊路径匹配停止其他实验的容器。
