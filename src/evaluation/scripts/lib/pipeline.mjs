import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';

import {
  assertDirectory,
  codexProviderArgs,
  evaluationRoot as projectRoot,
  loadEnvironment,
} from './config.mjs';
import { runJudge } from './judge.mjs';
import { defaultReferenceRoot, referenceIdentity, resolveVisualReferenceTarget, sameReferenceSnapshot, snapshotReference } from './references.mjs';
import {
  GSB_SCORES,
  JUDGE_MODE_PAIRWISE_GSB,
  detectProfile,
  isPointwiseLeafStatus,
  isTaskStatus,
  normalizeGsb,
  parsePromptGroups,
} from './tasks.mjs';
import {
  validateEvaluationArtifacts,
  writeEvaluationReports,
} from './report-writer.mjs';
import { resolveWorkspaceTarget } from './run-workspaces.mjs';

const topicSkillAliases = Object.freeze({
  'demo-particles': 'canvas-3d',
  'demo-shape': 'canvas-3d',
  'iphone-site': 'iphone-product-site',
  'siamese-nyc-svg': 'siamese-city-svg',
  'travel-app': 'mobile-travel-app',
});

function selectPromptGroup(repository, options) {
  const group = options.id
    ? repository.groups.find((item) => item.id === options.id)
    : repository.groups.find((item) => item.number === options.number);
  if (!group) {
    throw new Error(options.id
      ? `Question id not found in prompt repository: ${options.id}`
      : `Question number not found in prompt repository: ${options.number}`);
  }
  return group;
}

function hasPairwiseTask(group) {
  return group.requirements.some((item) => item.judgeMode === 'pairwise_gsb');
}

function resolveTargetPath(inputPath, questionId) {
  const path = resolve(inputPath);
  if (statSync(path).isFile()) {
    return {
      mode: 'static-file',
      workspacePath: dirname(path),
      root: dirname(path),
      entry: basename(path),
      entryPath: path,
      reason: 'using explicit HTML file',
    };
  }
  const target = resolveWorkspaceTarget(path);
  if (target.mode === 'unlaunchable') return target;
  return {
    ...target,
    entryPath: target.mode === 'static' ? join(target.root, target.entry) : '',
    questionId,
  };
}

export function resolveBenchmarkWorkspace({ workspace, questionId, benchmark, required, fallbackBenchmark = '' }) {
  if (!required) return null;
  const candidates = [];
  if (benchmark) candidates.push(resolve(benchmark));
  if (!benchmark && fallbackBenchmark) candidates.push(fallbackBenchmark);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const target = resolveVisualReferenceTarget(candidate, questionId) || resolveTargetPath(candidate, questionId);
    const candidateWorkspace = existsSync(workspace) ? realpathSync(workspace) : resolve(workspace);
    if (target.mode !== 'unlaunchable' && realpathSync(target.workspacePath) !== candidateWorkspace) {
      return target;
    }
  }
  throw new Error(`benchmark_unresolved for ${questionId}; pass --benchmark explicitly.`);
}

function ensureFreshOutput(outputRoot) {
  const root = resolve(outputRoot);
  if (existsSync(root)) {
    const entries = readdirSync(root);
    if (entries.length) {
      throw new Error(`Output directory is not empty: ${root}. Use a new path.`);
    }
  }
  mkdirSync(root, { recursive: true });
  for (const directory of ['data', 'logs', 'raw', 'remediation', 'reports', 'screenshots', 'scripts']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  return root;
}

export function resolveTopicSkillName(profile) {
  return topicSkillAliases[profile] || profile;
}

function skillPaths(profile) {
  const topicSkill = resolveTopicSkillName(profile);
  const paths = {
    pipeline: join(projectRoot, 'skills/pipeline/SKILL.md'),
    common: join(projectRoot, 'skills/page-evaluation/SKILL.md'),
    topic: join(projectRoot, `skills/page-evaluation/topics/${topicSkill}/SKILL.md`),
    report: join(projectRoot, 'skills/report-generation/SKILL.md'),
    judge: join(projectRoot, 'skills/judge/SKILL.md'),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (!existsSync(path)) throw new Error(`Missing ${name} Skill: ${path}`);
  }
  return paths;
}

function authoritativeRequirements(group) {
  return group.requirements.map((item) => ({
    taskId: String(item.taskId),
    judgeMode: item.judgeMode,
    task: item.task,
    criteriaText: item.criteriaText,
    originalCriteria: item.originalCriteria,
    criteriaSource: item.criteriaSource,
    criteria: item.criteria,
    criterionIds: item.criterionIds,
    instructions: item.instructions,
    validation: item.validation,
  }));
}

function pipelineContext({ options, group, profile, workspaceTarget, benchmarkTarget, outputRoot, skills }) {
  return {
    version: 1,
    fresh: true,
    question: {
      id: group.id,
      number: group.number,
      row: group.row,
      profile,
      promptPath: group.source.taskPath,
      judgePath: group.source.judgePath,
    },
    workspace: {
      path: options.workspace,
      target: workspaceTarget,
    },
    benchmark: benchmarkTarget
      ? {
          path: options.benchmark || benchmarkTarget.workspacePath, target: benchmarkTarget,
          reference: options.reference, visualEvidence: options.visualEvidence || null,
        }
      : null,
    promptsRoot: options.promptsRoot,
    outputRoot,
    rawResultPath: join(outputRoot, 'raw/evaluation-result.json'),
    requirements: authoritativeRequirements(group),
    runIdentity: {
      harness: options.harness,
      model: options.modelLabel,
      question: group.number,
      runId: options.runId,
    },
    skills,
  };
}

export function writePipelineContext(context) {
  const contextPath = join(context.outputRoot, 'pipeline-context.json');
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);
  return contextPath;
}

function resultSchemaExample(context) {
  return {
    id: context.question.id,
    buildAndRuntime: {
      status: 'unverified',
      reason: '记录实际构建、启动和浏览器访问结果；确认成功后才填写 passed，作品构建或运行失败填写 failed。',
      evidence: [],
    },
    requirementResults: context.requirements.map((requirement) => (
      requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB
        ? {
            taskId: requirement.taskId,
            judgeMode: requirement.judgeMode,
            status: 'completed',
            gsb: 'G',
            reason: ['被测侧在本 task 的高优维度上有明确、可观察的优势。'],
            evidence: {
              tested: ['/output/screenshots/tested-example.png'],
              benchmark: ['/output/screenshots/benchmark-example.png'],
            },
            comparison_meta: {
              viewport: '1440x900',
              interaction_path: ['打开页面', '执行相同交互', '在相同时刻采样'],
              sampled_at: '交互完成后的稳定状态',
              high_priority_dimensions: ['从 task 原文确定的高优维度'],
              ...(context.benchmark?.visualEvidence ? {
                reference_protocol: context.benchmark.visualEvidence.protocol,
                reference_scene_ids: context.benchmark.target.scenes.scenes.map((scene) => scene.id),
              } : {}),
            },
            criterionResults: requirement.criteria.map((criterion, index) => ({
              criterionId: requirement.criterionIds[index],
              criterion,
              reason: '该比较维度上的双侧具体观察；不单独输出 G/S/B 或 pass/fail。',
              evidence: {
                tested: ['/output/screenshots/tested-example.png'],
                benchmark: ['/output/screenshots/benchmark-example.png'],
              },
            })),
          }
        : {
            taskId: requirement.taskId,
            judgeMode: requirement.judgeMode,
            status: 'completed',
            reason: '该 task 的具体总结。',
            evidence: ['/output/data/task-level.json'],
            criterionResults: requirement.criteria.map((criterion, index) => ({
              criterionId: requirement.criterionIds[index],
              criterion,
              status: 'pass',
              reason: '针对该验证点的具体观察与结论。',
              evidence: ['/output/screenshots/example.png'],
            })),
          }
    )),
  };
}

export function buildInitialPrompt(context) {
  const schema = JSON.stringify(resultSchemaExample(context), null, 2);
  return `使用指定 Skill 执行评测阶段，但不要自行生成最终报告或运行 Strict Judge；父级 evaluate-pipeline runner 会统一完成报告和审计。

必须完整读取：
- ${context.skills.pipeline}
- ${context.skills.common}
- ${context.skills.topic}
- ${context.skills.report}
- ${context.skills.judge}

固定输入：
- workspace: ${context.workspace.path}
- prompts_root: ${context.promptsRoot}
- question: ${context.question.number} / ${context.question.id}
- judge: ${context.question.judgePath}
- benchmark: ${context.benchmark?.target?.entryPath || context.benchmark?.path || '无'}
- reference_mode: ${context.benchmark?.target?.mode || 'not-used'}
- frozen_visual_scenes: ${context.benchmark?.visualEvidence?.manifest || '无'}
- output_root: ${context.outputRoot}
- fresh: true

执行要求：
Judge JSON 的 criteria[] 和 criterion_id 是权威判分单元与编号，不得按文字编号重新拆分。instructions 与 validation.steps 必须读取，但不增加判分单元。
1. 只读取本轮 workspace、题库、必要 benchmark 和上述 Skill；不得读取任何旧 eval-output、旧 verdict 或旧报告。runner 核验后复制到本轮目录的冻结参考画面是公开评分输入，不是历史评测截图，允许且必须读取。
2. 使用 Playwright/Chromium 实际启动页面，执行 criteria 要求的交互、网络、DOM、源码、下载、状态和视觉检查。
3. 动态/视觉结论必须采集本轮序列截图或机器可读时间序列；视觉项必须实际查看截图后判定。
4. pairwise_gsb 必须按 GSB Decision Ladder 依次执行，以相同 viewport、初始状态、采样时刻和操作路径比较两侧；completed 时只输出一个 task 级 G/S/B，blocked 或 needs_review 时 gsb 必须为 null。
5. ${context.outputRoot} 由父级 runner 管理：严禁删除、清空或重命名该目录，严禁删除或覆盖已有的 pipeline-context.json、pipeline-state.json、logs/、reports/ 和 remediation/。
6. 所有临时脚本、截图和数据只能新增到 ${context.outputRoot} 的 scripts/、screenshots/、data/ 目录；只允许按要求更新 ${context.rawResultPath}，不得修改被测 workspace 或 benchmark。需要安装或构建时先复制到 /tmp，仅在副本执行，保持依赖锁文件与参考入口不变。
7. 不要写 reports/、不要运行 judge、不要计算最终分数或能力维度。
8. 最终必须把结构化结果写到 ${context.rawResultPath}。每个 criterion 必须有独立 criterionResult、具体 reason 和真实存在的 evidence 路径。
9. pairwise task 的 reason 必须是 1–2 条具体相对差异数组，evidence 必须分 tested/benchmark 两侧，comparison_meta 必须记录 viewport、interaction_path、sampled_at 和 high_priority_dimensions。
10. pairwise 的 criterion 仅作为比较维度和证据来源，不得携带 status、gsb、pairwiseVerdict 或 task_score；不得对子项投票或平均。
11. reference_mode=visual 时，标杆只有 scenes.json 和 PNG 画面，严禁尝试启动、安装或查找标杆源码。逐场景阅读 steps、viewport、reduced_motion、采样时间及所有帧，在被测侧以等价语义操作到达同类状态，并使用本轮截图与指定参考画面对比，不要求像素或布局相同。
12. visual 模式下 benchmark evidence 必须引用 frozen_visual_scenes 所在目录中已冻结的 PNG；comparison_meta 还须记录 reference_protocol 和使用过的 reference_scene_ids。completed 必须覆盖该任务全部参考场景，并在 benchmark evidence 列出这些场景的所有帧；同题 pointwise 仍正常执行，不参照图片判功能分。动态项须看序列帧；未覆盖的状态、连续运动细节及无法由图片证明的源码/数据/版权事实不得臆测。证据不足以决定高优维度时标记 needs_review，不得擅自删改 rubric。

13. 提供 buildAndRuntime：status 为 passed、failed 或 unverified，reason 说明构建、启动与浏览器访问结果，evidence 引用本轮执行日志（JSON/日志/文本）。静态页面验证浏览器可访问和正常运行；各 criterion 按各自证据独立判定。

结果结构示例（字段可增加，但不得缺少这些核心字段）：
${schema}

完成前自行确认 JSON 可解析且所有 evidence 文件存在。最终回复只需说明结构化结果已写入指定路径。`;
}

export function buildRemediationPrompt(context, judgeResult, round) {
  return `继续同一轮前端评测，执行 remediation 第 ${round} 轮。不要重新做无关验证，也不要直接按 Judge 文本篡改 verdict。

必须读取：
- pipeline context: ${join(context.outputRoot, 'pipeline-context.json')}
- 当前结构化结果: ${context.rawResultPath}
- Strict Judge JSON: ${join(context.outputRoot, 'reports/eval-judge-results-strict.json')}
- 相关 Skill: ${Object.values(context.skills).join(', ')}

Judge 当前问题：
${JSON.stringify(judgeResult.issues || [], null, 2)}

要求：
1. 只重跑受影响的 task/criterion；若是系统性问题才扩大范围。
2. verdict 只有在新执行或新证据支持时才允许变化。
3. 新截图、数据和脚本写入 ${join(context.outputRoot, `remediation/round-${String(round).padStart(2, '0')}`)} 或本轮 evidence 目录。
4. 更新 ${context.rawResultPath}，保持每个 criterion 一一对应；pairwise 继续使用 status + gsb + 双侧 evidence + comparison_meta 契约，不得对子项单独判 G/S/B。
5. 不删除原始证据和前一轮结果。
6. ${context.outputRoot} 由父级 runner 管理，严禁删除、清空或重命名根目录及 pipeline-context.json、pipeline-state.json、logs/、reports/、remediation/。
7. visual 模式保留本轮已复制的冻结参考 PNG 与 scenes.json，不启动标杆；只重采被测画面。画面不足时报告缺少的场景，不把参考帧伪称为本轮运行产物。

完成前确认 JSON 可解析、evidence 存在，并在最终回复中列出实际重跑的验证点。`;
}

async function runProcess(command, args, { cwd, logPath, input = '' }) {
  const log = createWriteStream(logPath, { flags: 'w' });
  log.write(`$ ${command} ${args.join(' ')}\n`);
  const child = spawn(command, args, {
    cwd,
    env: loadEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    log.write(chunk);
  });
  child.stdin.end(input);
  const code = await new Promise((resolveExit) => child.once('exit', resolveExit));
  log.end();
  return Number(code ?? 1);
}

async function runCodex(options, context, prompt, label) {
  const lastMessagePath = join(context.outputRoot, `logs/${label}-last-message.md`);
  const args = [
    ...codexProviderArgs(options),
    'exec',
    '--ephemeral',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '-C', context.workspace.path,
    '-o', lastMessagePath,
    '-',
  ];
  return runProcess(options.codexBin, args, {
    cwd: context.workspace.path,
    logPath: join(context.outputRoot, `logs/${label}.log`),
    input: prompt,
  });
}

function readRawResult(path) {
  if (!existsSync(path)) throw new Error(`Codex did not write evaluation result: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function normalizeRawEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : evidence ? [evidence] : [])
    .map((item) => typeof item === 'string' ? item : item?.path)
    .filter(Boolean)
    .map(String);
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value])
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizePairwiseEvidence(evidence, contractIssues, label) {
  const isRecord = evidence && typeof evidence === 'object' && !Array.isArray(evidence);
  if (!isRecord) {
    contractIssues.push(`${label}.evidence 必须是 { tested: [], benchmark: [] }。`);
  }
  if (isRecord && !Array.isArray(evidence.tested)) {
    contractIssues.push(`${label}.evidence.tested 必须是数组。`);
  }
  if (isRecord && !Array.isArray(evidence.benchmark)) {
    contractIssues.push(`${label}.evidence.benchmark 必须是数组。`);
  }
  return {
    tested: normalizeRawEvidence(isRecord ? evidence.tested : evidence),
    benchmark: normalizeRawEvidence(isRecord ? evidence.benchmark : []),
  };
}

function normalizeComparisonMeta(value, status, contractIssues) {
  const isRecord = value && typeof value === 'object' && !Array.isArray(value);
  if (!isRecord) contractIssues.push('comparison_meta 必须是对象。');
  const meta = {
    viewport: String(isRecord ? value.viewport || '' : '').trim(),
    interaction_path: normalizeStringList(isRecord ? value.interaction_path : []),
    sampled_at: String(isRecord ? value.sampled_at || '' : '').trim(),
    high_priority_dimensions: normalizeStringList(isRecord ? value.high_priority_dimensions : []),
    ...(isRecord && (value.reference_protocol || value.reference_scene_ids) ? {
      reference_protocol: String(value.reference_protocol || ''),
      reference_scene_ids: normalizeStringList(value.reference_scene_ids),
    } : {}),
  };
  if (!meta.viewport) contractIssues.push('comparison_meta.viewport 不能为空。');
  if (!meta.interaction_path.length) contractIssues.push('comparison_meta.interaction_path 不能为空。');
  if (!meta.sampled_at) contractIssues.push('comparison_meta.sampled_at 不能为空。');
  if (status !== 'blocked' && !meta.high_priority_dimensions.length) {
    contractIssues.push('comparison_meta.high_priority_dimensions 不能为空。');
  }
  return meta;
}

function pointwiseTaskStatus(children) {
  if (!children.length) return 'blocked';
  return children.some((item) => ['blocked/network', 'error'].includes(item.status))
    ? 'blocked'
    : 'completed';
}

function pointwiseTaskScore(children, status) {
  if (status !== 'completed' || !children.length) return null;
  return children.filter((item) => item.status === 'pass').length / children.length;
}

function flagLegacyRequirementFields(provided, contractIssues) {
  for (const field of ['judge', 'originalJudge', 'judgeSource', 'subResults']) {
    if (Object.hasOwn(provided, field)) {
      contractIssues.push(`结果使用了不支持的旧字段 ${field}。`);
    }
  }
}

function normalizePointwiseRequirement(provided, requirement) {
  const contractIssues = normalizeStringList(provided.contractIssues);
  flagLegacyRequirementFields(provided, contractIssues);
  for (const field of ['gsb', 'pairwiseVerdict', 'comparison_meta']) {
    if (Object.hasOwn(provided, field) && provided[field] !== undefined && provided[field] !== null) {
      contractIssues.push(`pointwise task 不得携带 ${field}。`);
    }
  }
  const providedCriteria = Array.isArray(provided.criterionResults)
    ? provided.criterionResults
    : [];
  if (providedCriteria.length !== requirement.criteria.length) {
    contractIssues.push(`pointwise criterion 数量不匹配：expected=${requirement.criteria.length}, actual=${providedCriteria.length}。`);
  }
  const criterionResults = requirement.criteria.map((criterion, index) => {
    const expectedId = requirement.criterionIds[index];
    const source = providedCriteria.find((item) => String(item.criterionId || '') === expectedId)
      || providedCriteria[index]
      || {};
    if (Object.hasOwn(source, 'taskId') || Object.hasOwn(source, 'task')) {
      contractIssues.push(`criterion ${expectedId} 使用了旧字段 taskId/task。`);
    }
    if (source.criterionId && String(source.criterionId) !== expectedId) {
      contractIssues.push(`criterion id 不匹配：expected=${expectedId}, actual=${source.criterionId}。`);
    }
    const {
      criterion: _criterion,
      criterionId: _criterionId,
      evidence: _criterionEvidence,
      reason: _criterionReason,
      status: _criterionStatus,
      task: _legacyTask,
      taskId: _legacyTaskId,
      ...criterionRest
    } = source;
    return {
      ...criterionRest,
      criterionId: expectedId,
      criterion,
      status: isPointwiseLeafStatus(source.status) ? String(source.status) : 'fail',
      reason: String(source.reason || `本轮未返回 criterion ${expectedId} 的具体评测结果。`),
      evidence: normalizeRawEvidence(source.evidence),
    };
  });
  const status = pointwiseTaskStatus(criterionResults);
  const expectedScore = pointwiseTaskScore(criterionResults, status);
  if (provided.task_score !== undefined && provided.task_score !== null) {
    const supplied = Number(provided.task_score);
    if (!Number.isFinite(supplied) || expectedScore === null || Math.abs(supplied - expectedScore) > 1e-9) {
      contractIssues.push('pointwise task_score 与 criterion 结果不一致，runner 已按 criterion 结果重算。');
    }
  }
  const {
    comparison_meta: _comparisonMeta,
    contractIssues: _contractIssues,
    criteria: _criteria,
    criteriaSource: _criteriaSource,
    criteriaText: _criteriaText,
    criterionResults: _criterionResults,
    gsb: _gsb,
    judge: _legacyJudge,
    judgeSource: _legacyJudgeSource,
    originalCriteria: _originalCriteria,
    originalJudge: _legacyOriginalJudge,
    pairwiseVerdict: _pairwiseVerdict,
    subResults: _legacySubResults,
    ...rest
  } = provided;
  return {
    ...rest,
    taskId: requirement.taskId,
    judgeMode: requirement.judgeMode,
    task: requirement.task,
    criteriaText: requirement.criteriaText,
    originalCriteria: requirement.originalCriteria,
    criteriaSource: requirement.criteriaSource,
    criteria: requirement.criteria,
    criterionIds: requirement.criterionIds,
    instructions: requirement.instructions,
    validation: requirement.validation,
    status,
    task_score: expectedScore,
    reason: String(provided.reason || ''),
    evidence: normalizeRawEvidence(provided.evidence),
    criterionResults,
    contractIssues: [...new Set(contractIssues)],
  };
}

function normalizePairwiseRequirement(provided, requirement) {
  const contractIssues = normalizeStringList(provided.contractIssues);
  flagLegacyRequirementFields(provided, contractIssues);
  if (Object.hasOwn(provided, 'pairwiseVerdict')) {
    contractIssues.push('pairwiseVerdict 已废弃，必须改用 task 级 gsb。');
  }
  const rawStatus = String(provided.status || '').trim().toLowerCase();
  const status = isTaskStatus(rawStatus) ? rawStatus : 'needs_review';
  if (!isTaskStatus(rawStatus)) {
    contractIssues.push(`pairwise status 非法或缺失：${rawStatus || '(empty)'}。`);
  }
  const rawGsb = provided.gsb;
  const normalizedGsb = normalizeGsb(rawGsb);
  let gsb = normalizedGsb;
  let taskScore = null;
  if (status === 'completed') {
    if (!normalizedGsb) contractIssues.push('completed pairwise task 必须有且仅有一个合法 G/S/B。');
    taskScore = normalizedGsb === null ? null : GSB_SCORES[normalizedGsb];
  } else {
    if (rawGsb !== undefined && rawGsb !== null && String(rawGsb).trim() !== '') {
      contractIssues.push(`${status} pairwise task 必须使用 gsb=null。`);
    }
    gsb = null;
  }
  if (provided.task_score !== undefined && provided.task_score !== null) {
    const supplied = Number(provided.task_score);
    if (taskScore === null || !Number.isFinite(supplied) || Math.abs(supplied - taskScore) > 1e-9) {
      contractIssues.push('pairwise task_score 与 status/gsb 不一致，runner 已按新契约重算。');
    }
  }
  const reason = normalizeStringList(provided.reason);
  if (!Array.isArray(provided.reason)) contractIssues.push('pairwise reason 必须是 1–2 条字符串数组。');
  if (reason.length < 1 || reason.length > 2) contractIssues.push('pairwise reason 必须包含 1–2 条具体相对差异。');
  const evidence = normalizePairwiseEvidence(provided.evidence, contractIssues, 'pairwise task');
  if (status !== 'blocked' && (!evidence.tested.length || !evidence.benchmark.length)) {
    contractIssues.push(`${status} pairwise task 必须同时提供 tested 与 benchmark 证据。`);
  }
  if (status === 'blocked' && !evidence.tested.length && !evidence.benchmark.length) {
    contractIssues.push('blocked pairwise task 至少应提供一侧的启动或阻塞证据。');
  }
  const comparisonMeta = normalizeComparisonMeta(provided.comparison_meta, status, contractIssues);
  const providedCriteria = Array.isArray(provided.criterionResults)
    ? provided.criterionResults
    : [];
  if (providedCriteria.length !== requirement.criteria.length) {
    contractIssues.push(`pairwise criterion 数量不匹配：expected=${requirement.criteria.length}, actual=${providedCriteria.length}。`);
  }
  const criterionResults = requirement.criteria.map((criterion, index) => {
    const expectedId = requirement.criterionIds[index];
    const source = providedCriteria.find((item) => String(item.criterionId || '') === expectedId)
      || providedCriteria[index]
      || {};
    if (Object.hasOwn(source, 'taskId') || Object.hasOwn(source, 'task')) {
      contractIssues.push(`pairwise criterion ${expectedId} 使用了旧字段 taskId/task。`);
    }
    if (source.criterionId && String(source.criterionId) !== expectedId) {
      contractIssues.push(`pairwise criterion id 不匹配：expected=${expectedId}, actual=${source.criterionId}。`);
    }
    for (const field of ['status', 'gsb', 'pairwiseVerdict', 'task_score']) {
      if (Object.hasOwn(source, field) && source[field] !== undefined && source[field] !== null) {
        contractIssues.push(`pairwise 子点 ${expectedId} 不得携带 ${field}。`);
      }
    }
    const subReason = normalizeStringList(source.reason).join('；');
    if (!subReason) contractIssues.push(`pairwise 子点 ${expectedId} 缺少具体 reason。`);
    const subEvidence = normalizePairwiseEvidence(source.evidence, contractIssues, `pairwise criterion ${expectedId}`);
    if (status !== 'blocked' && (!subEvidence.tested.length || !subEvidence.benchmark.length)) {
      contractIssues.push(`pairwise criterion ${expectedId} 必须同时提供 tested 与 benchmark 证据。`);
    }
    const {
      criterion: _criterion,
      criterionId: _criterionId,
      evidence: _criterionEvidence,
      gsb: _subGsb,
      pairwiseVerdict: _subPairwiseVerdict,
      reason: _criterionReason,
      status: _criterionStatus,
      task: _legacyTask,
      taskId: _legacyTaskId,
      task_score: _taskScore,
      ...criterionRest
    } = source;
    return {
      ...criterionRest,
      criterionId: expectedId,
      criterion,
      reason: subReason || `本轮未返回比较维度 ${expectedId} 的具体观察。`,
      evidence: subEvidence,
    };
  });
  const {
    comparison_meta: _comparisonMeta,
    contractIssues: _contractIssues,
    criteria: _criteria,
    criteriaSource: _criteriaSource,
    criteriaText: _criteriaText,
    criterionResults: _criterionResults,
    evidence: _evidence,
    gsb: _providedGsb,
    judge: _legacyJudge,
    judgeSource: _legacyJudgeSource,
    originalCriteria: _originalCriteria,
    originalJudge: _legacyOriginalJudge,
    pairwiseVerdict: _pairwiseVerdict,
    reason: _reason,
    status: _status,
    subResults: _legacySubResults,
    task_score: _taskScore,
    ...rest
  } = provided;
  return {
    ...rest,
    taskId: requirement.taskId,
    judgeMode: requirement.judgeMode,
    task: requirement.task,
    criteriaText: requirement.criteriaText,
    originalCriteria: requirement.originalCriteria,
    criteriaSource: requirement.criteriaSource,
    criteria: requirement.criteria,
    criterionIds: requirement.criterionIds,
    instructions: requirement.instructions,
    validation: requirement.validation,
    status,
    gsb,
    task_score: taskScore,
    reason,
    evidence,
    comparison_meta: comparisonMeta,
    criterionResults,
    contractIssues: [...new Set(contractIssues)],
  };
}

export function mergeAuthoritativeResult(raw, context) {
  const byTask = new Map((raw?.requirementResults || []).map((item) => [String(item.taskId || ''), item]));
  const requirementResults = context.requirements.map((requirement) => {
    const provided = byTask.get(requirement.taskId) || {};
    const normalized = requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB
      ? normalizePairwiseRequirement(provided, requirement)
      : normalizePointwiseRequirement(provided, requirement);
    if (requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB && context.benchmark?.visualEvidence) {
      const visual = context.benchmark.visualEvidence;
      const scenes = context.benchmark.target.scenes.scenes.filter((scene) => scene.criterion_ids
        .some((criterion) => requirement.criterionIds.includes(criterion)));
      const sceneIds = normalized.comparison_meta.reference_scene_ids || [];
      const allowedFrames = new Set(scenes.flatMap((scene) => scene.frames.map((frame) => resolve(visual.root, frame.path))));
      const evidence = normalized.evidence.benchmark.map((path) => resolve(context.outputRoot, path));
      if (normalized.comparison_meta.reference_protocol !== visual.protocol) {
        normalized.contractIssues.push('visual comparison_meta.reference_protocol 不匹配。');
      }
      if (new Set(sceneIds).size !== sceneIds.length || sceneIds.some((id) => !scenes.some((scene) => scene.id === id))) {
        normalized.contractIssues.push('visual comparison_meta.reference_scene_ids 包含未知或重复场景。');
      }
      if (evidence.some((path) => !allowedFrames.has(path))) {
        normalized.contractIssues.push('visual benchmark evidence 必须来自本轮复制的冻结 PNG。');
      }
      if (normalized.status === 'completed' && (scenes.some((scene) => !sceneIds.includes(scene.id))
        || [...allowedFrames].some((path) => !evidence.includes(path)))) {
        normalized.contractIssues.push('completed visual comparison 缺少参考场景或序列帧。');
      }
    }
    return normalized;
  });
  return {
    ...raw,
    id: context.question.id,
    row: context.question.row,
    number: context.question.number,
    profile: context.question.profile,
    url: String(raw?.url || raw?.pageUrl || raw?.finalUrl || ''),
    pageUrl: String(raw?.pageUrl || raw?.finalUrl || raw?.url || ''),
    workspace: context.workspace.path,
    benchmarkWorkspace: context.benchmark?.target?.entryPath || context.benchmark?.path || '',
    reference: context.benchmark?.reference || null,
    runIdentity: context.runIdentity,
    requirements: context.requirements,
    requirementResults,
    generatedAt: new Date().toISOString(),
  };
}

async function runStrictJudge(context, round) {
  const result = runJudge({
    promptsRoot: context.promptsRoot,
    resultsPath: join(context.outputRoot, 'reports/eval-summary-results.json'),
    reportRoot: join(context.outputRoot, 'reports'),
    ids: new Set([context.question.id]),
    strict: true,
  });
  writeFileSync(
    join(context.outputRoot, `logs/judge-round-${String(round).padStart(2, '0')}.log`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}

function copyJudgeArtifacts(context, round, phase) {
  const target = join(context.outputRoot, `remediation/round-${String(round).padStart(2, '0')}`);
  mkdirSync(target, { recursive: true });
  for (const [source, name] of [
    [join(context.outputRoot, 'reports/eval-judge-results-strict.json'), `judge-${phase}.json`],
    [join(context.outputRoot, 'reports/md/eval-judge-report-strict.md'), `judge-${phase}.md`],
    [join(context.outputRoot, 'reports/html/eval-judge-report-strict.html'), `judge-${phase}.html`],
  ]) {
    if (existsSync(source)) copyFileSync(source, join(target, name));
  }
}

function judgeFinalStatus(judgeResult, result) {
  if ((judgeResult.counts?.high || 0) > 0) return 'invalid';
  if (result?.status === 'blocked') return 'blocked';
  if ((judgeResult.counts?.medium || 0) > 0) return 'needs-followup';
  return judgeResult.status === 'pass' ? 'ready' : 'invalid';
}

function writePipelineState(context, state) {
  writeFileSync(
    join(context.outputRoot, 'pipeline-state.json'),
    `${JSON.stringify({
      version: 1,
      question: context.question,
      workspace: context.workspace.path,
      benchmarkWorkspace: context.benchmark?.target?.entryPath || context.benchmark?.path || '',
      reference: context.benchmark?.reference || null,
      promptsRoot: context.promptsRoot,
      outputRoot: context.outputRoot,
      runIdentity: context.runIdentity,
      skills: context.skills,
      updatedAt: new Date().toISOString(),
      ...state,
    }, null, 2)}\n`,
  );
}

export async function runPipeline(options) {
  options.promptsRoot = assertDirectory(options.promptsRoot, '--prompts');
  options.workspace = assertDirectory(options.workspace, '--workspace');
  if (!options.id && !options.number) throw new Error('Pass --id or --number.');
  if (!options.outputRoot) throw new Error('Missing --output-root.');
  const repository = parsePromptGroups(options.promptsRoot);
  const group = selectPromptGroup(repository, options);
  const profile = detectProfile(group);
  const workspaceTarget = resolveTargetPath(options.workspace, group.id);
  if (workspaceTarget.mode === 'unlaunchable') throw new Error(workspaceTarget.reason);
  const referencesRoot = !options.benchmark && hasPairwiseTask(group)
    ? defaultReferenceRoot(options.promptsRoot, repository) : '';
  const benchmarkTarget = resolveBenchmarkWorkspace({
    workspace: options.workspace,
    questionId: group.id,
    benchmark: options.benchmark,
    required: hasPairwiseTask(group),
    fallbackBenchmark: referencesRoot ? join(referencesRoot, group.id) : '',
  });
  options.reference = referenceIdentity(benchmarkTarget, group, repository);
  const referenceOptions = { visualOnly: benchmarkTarget?.mode === 'visual' };
  const referenceSnapshot = benchmarkTarget
    ? snapshotReference(benchmarkTarget.workspacePath, referenceOptions) : null;
  options.visualEvidence = null;
  const outputRoot = ensureFreshOutput(options.outputRoot);
  if (benchmarkTarget?.mode === 'visual') {
    const root = join(outputRoot, 'screenshots/reference', group.id);
    mkdirSync(join(root, 'images'), { recursive: true });
    for (const filename of Object.keys(referenceSnapshot.files)) {
      copyFileSync(join(benchmarkTarget.root, filename), join(root, filename));
    }
    options.visualEvidence = { root, manifest: join(root, 'scenes.json'), protocol: options.reference.protocol };
  }
  const verifyReferenceUnchanged = () => {
    if (JSON.stringify(referenceIdentity(benchmarkTarget, group, repository)) !== JSON.stringify(options.reference)
      || (referenceSnapshot && !sameReferenceSnapshot(
        referenceSnapshot, snapshotReference(benchmarkTarget.workspacePath, referenceOptions),
      ))
      || (options.visualEvidence && !sameReferenceSnapshot(
        referenceSnapshot, snapshotReference(options.visualEvidence.root, referenceOptions),
      ))) {
      throw new Error('Reference content changed during evaluation; discard this comparison.');
    }
  };
  verifyReferenceUnchanged();
  const skills = skillPaths(profile);
  const context = pipelineContext({
    options,
    group,
    profile,
    workspaceTarget,
    benchmarkTarget,
    outputRoot,
    skills,
  });
  writePipelineContext(context);
  const initialPrompt = buildInitialPrompt(context);
  writeFileSync(join(outputRoot, 'logs/initial-prompt.md'), `${initialPrompt}\n`);
  writePipelineState(context, { stage: options.dryRun ? 'prepared' : 'evaluating', remediationRounds: 0 });
  if (options.dryRun) {
    return { status: 'prepared', contextPath: join(outputRoot, 'pipeline-context.json'), outputRoot };
  }

  const initialExit = await runCodex(options, context, initialPrompt, 'codex-initial');
  if (initialExit !== 0) throw new Error(`Codex initial evaluation exited with code ${initialExit}.`);
  verifyReferenceUnchanged();
  writePipelineContext(context);

  let raw = readRawResult(context.rawResultPath);
  let result = mergeAuthoritativeResult(raw, context);
  let reports = writeEvaluationReports({ outputRoot, results: [result] });
  writePipelineState(context, { stage: 'auditing', remediationRounds: 0 });
  let judgeResult = await runStrictJudge(context, 0);
  let remediationRounds = 0;

  while (judgeResult.status !== 'pass' && remediationRounds < options.maxRemediation) {
    remediationRounds += 1;
    copyJudgeArtifacts(context, remediationRounds, 'before');
    writePipelineState(context, {
      stage: 'remediating',
      remediationRounds,
      strictJudge: judgeResult,
    });
    writePipelineContext(context);
    const prompt = buildRemediationPrompt(context, judgeResult, remediationRounds);
    writeFileSync(
      join(outputRoot, `remediation/round-${String(remediationRounds).padStart(2, '0')}/prompt.md`),
      `${prompt}\n`,
    );
    const code = await runCodex(options, context, prompt, `codex-remediation-${String(remediationRounds).padStart(2, '0')}`);
    if (code !== 0) throw new Error(`Codex remediation round ${remediationRounds} exited with code ${code}.`);
    verifyReferenceUnchanged();
    writePipelineContext(context);
    raw = readRawResult(context.rawResultPath);
    result = mergeAuthoritativeResult(raw, context);
    reports = writeEvaluationReports({ outputRoot, results: [result] });
    judgeResult = await runStrictJudge(context, remediationRounds);
    copyJudgeArtifacts(context, remediationRounds, 'after');
  }

  const validation = validateEvaluationArtifacts({ outputRoot, results: reports.results });
  if (!validation.ok) {
    throw new Error(`Artifact validation failed: ${JSON.stringify(validation)}`);
  }
  const finalStatus = judgeFinalStatus(judgeResult, reports.results[0]);
  writePipelineState(context, {
    stage: finalStatus,
    finalStatus,
    remediationRounds,
    strictJudge: judgeResult,
    taskStatus: reports.results[0].status,
    productStatus: reports.results[0].status,
    pointwiseSummary: reports.results[0].pointwiseSummary,
    pairwiseSummary: reports.results[0].pairwiseSummary,
    scoreSummary: reports.results[0].scoreSummary,
    buildAndRuntime: reports.results[0].buildAndRuntime,
    reportPaths: {
      results: reports.resultsPath,
      markdown: reports.results[0].reportPath,
      html: reports.results[0].htmlReportPath,
      summaryMarkdown: reports.summaryMarkdownPath,
      summaryHtml: reports.summaryHtmlPath,
    },
    unresolvedIssues: judgeResult.issues || [],
  });
  return {
    status: finalStatus,
    taskStatus: reports.results[0].status,
    productStatus: reports.results[0].status,
    pointwiseSummary: reports.results[0].pointwiseSummary,
    pairwiseSummary: reports.results[0].pairwiseSummary,
    scoreSummary: reports.results[0].scoreSummary,
    strictJudge: judgeResult,
    remediationRounds,
    outputRoot,
  };
}
