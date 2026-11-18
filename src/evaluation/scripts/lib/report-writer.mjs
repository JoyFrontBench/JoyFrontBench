import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import {
  GSB_SCORES,
  JUDGE_MODE_PAIRWISE_GSB,
  POINTWISE_LEAF_STATUSES,
  TASK_STATUSES,
  isTaskStatus,
  normalizeGsb,
} from './tasks.mjs';

const statuses = new Set(POINTWISE_LEAF_STATUSES);
const taskStatuses = new Set(TASK_STATUSES);
const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function htmlText(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function htmlAttribute(value) {
  return htmlText(value).replace(/'/gu, '&#39;');
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r/gu, '')
    .replace(/\n/gu, '<br>')
    .replace(/\|/gu, '\\|');
}

function portableRelative(fromFile, target) {
  return relative(dirname(fromFile), target).replace(/\\/gu, '/');
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return statuses.has(status) ? status : 'fail';
}

function normalizeTaskStatus(value, fallback = 'blocked') {
  const status = String(value || '').trim().toLowerCase();
  return taskStatuses.has(status) ? status : fallback;
}

function normalizeJudgeMode(value) {
  return String(value || '').trim().toLowerCase() === 'pairwise_gsb'
    ? 'pairwise_gsb'
    : 'pointwise';
}

function normalizeEvidenceItem(item, outputRoot) {
  const value = typeof item === 'string' ? item : item?.path;
  if (!value) return null;
  const path = resolve(String(value).startsWith('/') ? String(value) : join(outputRoot, String(value)));
  return {
    path,
    label: String(typeof item === 'object' && item?.label ? item.label : basename(path)),
  };
}

export function normalizeEvidence(evidence, outputRoot) {
  const items = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const value = normalizeEvidenceItem(item, outputRoot);
    if (!value || seen.has(value.path)) continue;
    seen.add(value.path);
    normalized.push(value);
  }
  return normalized;
}

function normalizePairwiseEvidence(evidence, outputRoot) {
  const isRecord = evidence && typeof evidence === 'object' && !Array.isArray(evidence);
  return {
    tested: normalizeEvidence(isRecord ? evidence.tested : evidence, outputRoot).map((item) => item.path),
    benchmark: normalizeEvidence(isRecord ? evidence.benchmark : [], outputRoot).map((item) => item.path),
  };
}

function hasPairwiseEvidenceShape(evidence) {
  return Boolean(
    evidence
    && typeof evidence === 'object'
    && !Array.isArray(evidence)
    && Array.isArray(evidence.tested)
    && Array.isArray(evidence.benchmark),
  );
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value])
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function resultCriteria(result) {
  return (result.requirementResults || []).flatMap((item) => (
    item.judgeMode === 'pairwise_gsb'
      ? []
      : item.criterionResults?.length
        ? item.criterionResults
        : [item]
  ));
}

function pairwiseItems(result) {
  return (result.requirementResults || []).filter((item) => item.judgeMode === JUDGE_MODE_PAIRWISE_GSB);
}

function countStatuses(items) {
  const counts = { pass: 0, fail: 0, 'blocked/network': 0, error: 0 };
  for (const item of items) {
    const status = normalizeStatus(item.status);
    counts[status] += 1;
  }
  return counts;
}

function deriveOverallStatus(result) {
  const values = (result.requirementResults || []).map((item) => normalizeTaskStatus(item.status));
  if (values.includes('blocked')) return 'blocked';
  if (values.includes('needs_review')) return 'needs_review';
  return values.length ? 'completed' : 'blocked';
}

function normalizeCriterionResult(criterionResult, parent, index, outputRoot, contractIssues) {
  const source = criterionResult && typeof criterionResult === 'object' ? criterionResult : {};
  if (Object.hasOwn(source, 'taskId') || Object.hasOwn(source, 'task')) {
    contractIssues.push(`criterion ${parent.taskId}.${index + 1} 使用了旧字段 taskId/task。`);
  }
  const {
    criterion: _criterion,
    criterionId: _criterionId,
    evidence: _evidence,
    task: _legacyTask,
    taskId: _legacyTaskId,
    ...rest
  } = source;
  return {
    ...rest,
    criterionId: String(source.criterionId || parent.criterionIds?.[index] || `${parent.taskId}.${index + 1}`),
    criterion: String(source.criterion || parent.criteria?.[index] || ''),
    status: normalizeStatus(source.status),
    reason: String(source.reason || ''),
    evidence: normalizeEvidence(source.evidence, outputRoot).map((item) => item.path),
  };
}

function normalizePairwiseCriterionResult(criterionResult, parent, index, outputRoot, contractIssues) {
  const source = criterionResult && typeof criterionResult === 'object' ? criterionResult : {};
  const criterionId = String(source.criterionId || parent.criterionIds?.[index] || `${parent.taskId}.${index + 1}`);
  if (Object.hasOwn(source, 'taskId') || Object.hasOwn(source, 'task')) {
    contractIssues.push(`pairwise criterion ${criterionId} 使用了旧字段 taskId/task。`);
  }
  for (const field of ['status', 'gsb', 'pairwiseVerdict', 'task_score']) {
    if (Object.hasOwn(source, field) && source[field] !== undefined && source[field] !== null) {
      contractIssues.push(`pairwise criterion ${criterionId} 不得携带 ${field}。`);
    }
  }
  const reason = normalizeStringList(source.reason).join('；');
  if (!reason) contractIssues.push(`pairwise criterion ${criterionId} 缺少具体 reason。`);
  if (!hasPairwiseEvidenceShape(source.evidence)) {
    contractIssues.push(`pairwise criterion ${criterionId} 的 evidence 必须分 tested/benchmark 两侧。`);
  }
  const evidence = normalizePairwiseEvidence(source.evidence, outputRoot);
  if (parent.status !== 'blocked' && (!evidence.tested.length || !evidence.benchmark.length)) {
    contractIssues.push(`pairwise criterion ${criterionId} 必须同时提供 tested 与 benchmark 证据。`);
  }
  const {
    criterion: _criterion,
    criterionId: _criterionId,
    evidence: _evidence,
    gsb: _gsb,
    pairwiseVerdict: _pairwiseVerdict,
    reason: _reason,
    status: _status,
    task: _legacyTask,
    taskId: _legacyTaskId,
    task_score: _taskScore,
    ...rest
  } = source;
  return {
    ...rest,
    criterionId,
    criterion: String(source.criterion || parent.criteria?.[index] || ''),
    reason,
    evidence,
  };
}

function normalizeComparisonMeta(value) {
  const isRecord = value && typeof value === 'object' && !Array.isArray(value);
  return {
    viewport: String(isRecord ? value.viewport || '' : '').trim(),
    interaction_path: normalizeStringList(isRecord ? value.interaction_path : []),
    sampled_at: String(isRecord ? value.sampled_at || '' : '').trim(),
    high_priority_dimensions: normalizeStringList(isRecord ? value.high_priority_dimensions : []),
    ...(isRecord && (value.reference_protocol || value.reference_scene_ids) ? {
      reference_protocol: String(value.reference_protocol || ''),
      reference_scene_ids: normalizeStringList(value.reference_scene_ids),
    } : {}),
  };
}

function normalizeRequirementResult(requirementResult, outputRoot) {
  const judgeMode = normalizeJudgeMode(requirementResult.judgeMode);
  const criteria = Array.isArray(requirementResult.criteria)
    ? requirementResult.criteria.map(String)
    : (Array.isArray(requirementResult.criterionResults) ? requirementResult.criterionResults : [])
      .map((item) => String(item.criterion || ''));
  const contractIssues = normalizeStringList(requirementResult.contractIssues);
  if (!criteria.length || criteria.some((criterion) => !criterion.trim())) {
    contractIssues.push('结果缺少非空结构化 criteria 或 criterionResults；不从 criteriaText 推断判分单元。');
  }
  for (const field of ['judge', 'originalJudge', 'judgeSource', 'subResults']) {
    if (Object.hasOwn(requirementResult, field)) {
      contractIssues.push(`结果使用了不支持的旧字段 ${field}。`);
    }
  }
  const {
    contractIssues: _contractIssues,
    criteria: _criteria,
    criterionResults: _criterionResults,
    judge: _legacyJudge,
    originalJudge: _legacyOriginalJudge,
    judgeSource: _legacyJudgeSource,
    pairwiseVerdict: _pairwiseVerdict,
    subResults: _legacySubResults,
    ...rest
  } = requirementResult;
  const normalized = {
    ...rest,
    taskId: String(requirementResult.taskId || ''),
    judgeMode,
    task: String(requirementResult.task || ''),
    criteriaText: String(requirementResult.criteriaText || ''),
    originalCriteria: String(requirementResult.originalCriteria || requirementResult.criteriaText || ''),
    criteriaSource: 'criteria',
    criteria,
  };
  if (judgeMode === JUDGE_MODE_PAIRWISE_GSB) {
    if (Object.hasOwn(requirementResult, 'pairwiseVerdict')) {
      contractIssues.push('pairwiseVerdict 已废弃，必须改用 task 级 gsb。');
    }
    const status = normalizeTaskStatus(requirementResult.status, 'needs_review');
    if (!isTaskStatus(requirementResult.status)) {
      contractIssues.push(`pairwise status 非法或缺失：${requirementResult.status || '(empty)'}。`);
    }
    const gsb = normalizeGsb(requirementResult.gsb);
    if (status === 'completed' && !gsb) {
      contractIssues.push('completed pairwise task 必须有且仅有一个合法 G/S/B。');
    }
    if (status !== 'completed' && requirementResult.gsb !== null) {
      contractIssues.push(`${status} pairwise task 必须使用 gsb=null。`);
    }
    normalized.status = status;
    normalized.gsb = status === 'completed' ? gsb : null;
    normalized.task_score = normalized.gsb === null ? null : GSB_SCORES[normalized.gsb];
    normalized.reason = normalizeStringList(requirementResult.reason);
    if (!Array.isArray(requirementResult.reason) || normalized.reason.length < 1 || normalized.reason.length > 2) {
      contractIssues.push('pairwise reason 必须是 1–2 条具体相对差异数组。');
    }
    if (!hasPairwiseEvidenceShape(requirementResult.evidence)) {
      contractIssues.push('pairwise evidence 必须分 tested/benchmark 两侧。');
    }
    normalized.evidence = normalizePairwiseEvidence(requirementResult.evidence, outputRoot);
    if (status !== 'blocked' && (!normalized.evidence.tested.length || !normalized.evidence.benchmark.length)) {
      contractIssues.push(`${status} pairwise task 必须同时提供 tested 与 benchmark 证据。`);
    }
    if (status === 'blocked' && !normalized.evidence.tested.length && !normalized.evidence.benchmark.length) {
      contractIssues.push('blocked pairwise task 至少应提供一侧的启动或阻塞证据。');
    }
    normalized.comparison_meta = normalizeComparisonMeta(requirementResult.comparison_meta);
    if (!requirementResult.comparison_meta || typeof requirementResult.comparison_meta !== 'object' || Array.isArray(requirementResult.comparison_meta)) {
      contractIssues.push('comparison_meta 必须是对象。');
    }
    if (!normalized.comparison_meta.viewport) contractIssues.push('comparison_meta.viewport 不能为空。');
    if (!normalized.comparison_meta.interaction_path.length) contractIssues.push('comparison_meta.interaction_path 不能为空。');
    if (!normalized.comparison_meta.sampled_at) contractIssues.push('comparison_meta.sampled_at 不能为空。');
    if (status !== 'blocked' && !normalized.comparison_meta.high_priority_dimensions.length) {
      contractIssues.push('comparison_meta.high_priority_dimensions 不能为空。');
    }
    const suppliedScore = requirementResult.task_score;
    if (suppliedScore !== undefined && suppliedScore !== null) {
      if (normalized.task_score === null || !Number.isFinite(Number(suppliedScore)) || Math.abs(Number(suppliedScore) - normalized.task_score) > 1e-9) {
        contractIssues.push('pairwise task_score 与 status/gsb 不一致。');
      }
    }
    const sourceCriteria = Array.isArray(requirementResult.criterionResults)
      ? requirementResult.criterionResults
      : [];
    if (sourceCriteria.length !== criteria.length) {
      contractIssues.push(`pairwise criterion 数量不匹配：expected=${criteria.length}, actual=${sourceCriteria.length}。`);
    }
    normalized.criterionResults = sourceCriteria.map((item, index) => (
      normalizePairwiseCriterionResult(item, normalized, index, outputRoot, contractIssues)
    ));
  } else {
    normalized.reason = String(requirementResult.reason || '');
    normalized.evidence = normalizeEvidence(requirementResult.evidence, outputRoot).map((item) => item.path);
    const sourceCriteria = Array.isArray(requirementResult.criterionResults)
      ? requirementResult.criterionResults
      : [];
    normalized.criterionResults = sourceCriteria.map((item, index) => (
      normalizeCriterionResult(item, normalized, index, outputRoot, contractIssues)
    ));
    normalized.status = deriveStatusFromChildren(normalized.criterionResults);
    normalized.task_score = normalized.status === 'completed' && normalized.criterionResults.length
      ? normalized.criterionResults.filter((item) => item.status === 'pass').length / normalized.criterionResults.length
      : null;
  }
  normalized.contractIssues = [...new Set(contractIssues)];
  return normalized;
}

function deriveStatusFromChildren(items) {
  if (!items.length) return 'blocked';
  return items.some((item) => ['blocked/network', 'error'].includes(normalizeStatus(item.status)))
    ? 'blocked'
    : 'completed';
}

function scoreRequirement(requirement) {
  if (requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB) {
    const valid = requirement.status === 'completed' && normalizeGsb(requirement.gsb) !== null;
    const score = valid ? GSB_SCORES[requirement.gsb] : null;
    return {
      effective_only: score,
      zero_fill: score ?? 0,
      valid: valid ? 1 : 0,
      total: 1,
      coverage: valid ? 1 : 0,
      exceptions: valid ? 0 : 1,
    };
  }
  const leaves = requirement.criterionResults || [];
  const validLeaves = leaves.filter((item) => ['pass', 'fail'].includes(item.status));
  const passCount = validLeaves.filter((item) => item.status === 'pass').length;
  return {
    effective_only: validLeaves.length ? passCount / validLeaves.length : null,
    zero_fill: leaves.length ? passCount / leaves.length : 0,
    valid: validLeaves.length,
    total: leaves.length,
    coverage: leaves.length ? validLeaves.length / leaves.length : 0,
    exceptions: leaves.length - validLeaves.length,
  };
}

function scoreResult(requirements) {
  const tasks = requirements.map((item) => ({ taskId: item.taskId, ...scoreRequirement(item) }));
  const effectiveTasks = tasks.filter((item) => item.effective_only !== null);
  return {
    stage: 'pre_audit',
    tasks,
    effective_only: {
      score: effectiveTasks.length
        ? effectiveTasks.reduce((sum, item) => sum + item.effective_only, 0) / effectiveTasks.length
        : null,
      valid: effectiveTasks.length,
      total: tasks.length,
      coverage: tasks.length ? effectiveTasks.length / tasks.length : 0,
    },
    zero_fill: {
      score: tasks.length
        ? tasks.reduce((sum, item) => sum + item.zero_fill, 0) / tasks.length
        : null,
      exceptions: tasks.reduce((sum, item) => sum + item.exceptions, 0),
      total: tasks.length,
    },
  };
}

function normalizeResult(result, outputRoot, paths) {
  const normalized = {
    ...result,
    id: String(result.id || ''),
    row: Number(result.row),
    number: Number(result.number),
    profile: String(result.profile || ''),
    url: String(result.url || ''),
    workspace: String(result.workspace || ''),
    benchmarkWorkspace: String(result.benchmarkWorkspace || ''),
    buildAndRuntime: {
      status: result.buildAndRuntime?.status ?? 'unverified',
      reason: result.buildAndRuntime?.reason ?? '',
      evidence: Array.isArray(result.buildAndRuntime?.evidence)
        ? normalizeEvidence(result.buildAndRuntime.evidence, outputRoot).map((item) => item.path)
        : result.buildAndRuntime?.evidence ?? [],
    },
    requirementResults: (result.requirementResults || []).map((item) => (
      normalizeRequirementResult(item, outputRoot)
    )),
  };
  const counts = countStatuses(resultCriteria(normalized));
  normalized.pointwiseSummary = {
    pass: counts.pass,
    fail: counts.fail,
    blocked: counts['blocked/network'],
    error: counts.error,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
  normalized.pairwiseSummary = pairwiseItems(normalized).map((item) => ({
    taskId: item.taskId,
    status: item.status,
    gsb: item.gsb,
    task_score: item.task_score,
  }));
  normalized.scoreSummary = scoreResult(normalized.requirementResults);
  normalized.status = deriveOverallStatus(normalized);
  normalized.reportPath = paths.markdown;
  normalized.htmlReportPath = paths.html;
  return normalized;
}

function isImage(path) {
  return imageExtensions.has(extname(path).toLowerCase());
}

function isJson(path) {
  return extname(path).toLowerCase() === '.json';
}

function jsonPreview(path, limit = 1800) {
  if (!existsSync(path) || !statSync(path).isFile()) return '';
  const text = readFileSync(path, 'utf8');
  return text.length > limit
    ? `${text.slice(0, limit)}\n… truncated; full characters=${text.length}`
    : text;
}

function markdownEvidenceItem(reportPath, item) {
  if (!item) return '无';
  const href = portableRelative(reportPath, item.path);
  if (isImage(item.path)) return `![${markdownCell(item.label)}](${href})`;
  if (isJson(item.path)) {
    const preview = markdownCell(jsonPreview(item.path));
    return `[文件：${markdownCell(item.label)}](${href})<details open><summary>JSON 预览</summary><pre>${preview}</pre></details>`;
  }
  return `[文件：${markdownCell(item.label)}](${href})`;
}

function htmlEvidenceItem(reportPath, item) {
  if (!item) return '<span class="muted">无</span>';
  const href = htmlAttribute(portableRelative(reportPath, item.path));
  const label = htmlText(item.label);
  if (isImage(item.path)) {
    return `<figure><a href="${href}"><img src="${href}" alt="${label}"></a><figcaption>${label}</figcaption></figure>`;
  }
  if (isJson(item.path)) {
    return `<div class="evidence-file"><a href="${href}">文件：${label}</a><details open><summary>JSON 预览</summary><pre>${htmlText(jsonPreview(item.path))}</pre></details></div>`;
  }
  return `<div class="evidence-file"><a href="${href}">文件：${label}</a></div>`;
}

function reportRows(result) {
  const rows = [];
  for (const requirement of result.requirementResults || []) {
    if (requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB) {
      const observations = requirement.criterionResults?.length ? requirement.criterionResults : [requirement];
      observations.forEach((item, index) => rows.push({
        requirement,
        item,
        validationId: item.criterionId || `${requirement.taskId}.${index + 1}`,
        displayStatus: `比较维度（task级 ${requirement.gsb || requirement.status}）`,
      }));
      continue;
    }
    const leaves = requirement.criterionResults?.length ? requirement.criterionResults : [requirement];
    leaves.forEach((item, index) => rows.push({
      requirement,
      item,
      validationId: item.criterionId || `${requirement.taskId}.${index + 1}`,
      displayStatus: normalizeStatus(item.status),
    }));
  }
  return rows;
}

function pairwiseEvidenceItems(evidence, outputRoot) {
  const normalized = normalizePairwiseEvidence(evidence, outputRoot);
  return [
    ...normalizeEvidence(normalized.tested, outputRoot).map((item) => ({
      ...item,
      label: `tested · ${item.label}`,
    })),
    ...normalizeEvidence(normalized.benchmark, outputRoot).map((item) => ({
      ...item,
      label: `benchmark · ${item.label}`,
    })),
  ];
}

function rowEvidence(row, outputRoot) {
  if (row.requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB) {
    const source = row.item.evidence || row.requirement.evidence;
    return pairwiseEvidenceItems(source, outputRoot);
  }
  const source = row.item.evidence?.length ? row.item.evidence : row.requirement.evidence;
  return normalizeEvidence(source, outputRoot);
}

function screenshotArchive(result, outputRoot) {
  const seen = new Set();
  const screenshots = [];
  for (const requirement of result.requirementResults || []) {
    for (const item of [requirement, ...(requirement.criterionResults || [])]) {
      const evidenceItems = requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB
        ? pairwiseEvidenceItems(item.evidence, outputRoot)
        : normalizeEvidence(item.evidence, outputRoot);
      for (const evidence of evidenceItems) {
        if (!isImage(evidence.path) || seen.has(evidence.path)) continue;
        seen.add(evidence.path);
        screenshots.push(evidence);
      }
    }
  }
  return screenshots;
}

function scoreText(value) {
  return value === null || value === undefined
    ? '不可用'
    : `${(Number(value) * 100).toFixed(1)}%`;
}

function pairwiseSummaryText(items) {
  return items.length
    ? items.map((item) => `${item.taskId}=${item.gsb || item.status}`).join(', ')
    : '无';
}

function markdownEvidenceLinks(reportPath, items) {
  return items.length
    ? items.map((item) => `[${markdownCell(item.label)}](${portableRelative(reportPath, item.path)})`).join('、')
    : '无';
}

function htmlEvidenceLinks(reportPath, items) {
  return items.length
    ? items.map((item) => `<a href="${htmlAttribute(portableRelative(reportPath, item.path))}">${htmlText(item.label)}</a>`).join('、')
    : '无';
}

function writeQuestionMarkdown(result, reportPath, outputRoot) {
  const lines = [
    `# ${result.id} 前端评测报告`,
    '',
    `- 题号：${result.number}`,
    `- Excel 行：${result.row}`,
    `- 题型：${result.profile || '未识别'}`,
    `- 页面 URL：${result.pageUrl || result.finalUrl || result.url || '无'}`,
    `- 被测 workspace：\`${result.workspace || ''}\``,
    `- Benchmark：${result.benchmarkWorkspace ? `\`${result.benchmarkWorkspace}\`` : '无'}`,
    `- task 汇总状态：\`${result.status}\``,
    `- Pointwise：${result.pointwiseSummary.pass}/${result.pointwiseSummary.total} pass，${result.pointwiseSummary.fail} fail`,
    `- Pairwise：${pairwiseSummaryText(result.pairwiseSummary)}`,
    `- 构建与运行：${result.buildAndRuntime.status}；${markdownCell(result.buildAndRuntime.reason)}`,
    `- 有效 Task 均分：${scoreText(result.scoreSummary.effective_only.score)}，task 覆盖率 ${result.scoreSummary.effective_only.valid}/${result.scoreSummary.effective_only.total}`,
    `- Task 均分（异常计零）：${scoreText(result.scoreSummary.zero_fill.score)}，异常计分项 ${result.scoreSummary.zero_fill.exceptions}`,
    '',
    '## 要求列表',
    '',
    '| task | mode | task | criteria |',
    '| --- | --- | --- | --- |',
  ];
  for (const requirement of result.requirementResults || []) {
    lines.push(`| ${markdownCell(requirement.taskId)} | ${markdownCell(requirement.judgeMode)} | ${markdownCell(requirement.task)} | ${markdownCell(requirement.criteriaText)} |`);
  }
  const pairwise = pairwiseItems(result);
  if (pairwise.length) {
    lines.push('', '## Pairwise GSB task级结论', '');
    for (const requirement of pairwise) {
      const tested = normalizeEvidence(requirement.evidence.tested, outputRoot);
      const benchmark = normalizeEvidence(requirement.evidence.benchmark, outputRoot);
      lines.push(
        `### task ${requirement.taskId}: ${requirement.gsb || requirement.status}`,
        '',
        `- status：\`${requirement.status}\``,
        `- gsb：${requirement.gsb ? `\`${requirement.gsb}\`` : '`null`'}`,
        `- task_score：${requirement.task_score === null ? '`null`' : requirement.task_score}`,
        `- reason：${requirement.reason.length ? requirement.reason.map(markdownCell).join('；') : '无'}`,
        `- tested evidence：${markdownEvidenceLinks(reportPath, tested)}`,
        `- benchmark evidence：${markdownEvidenceLinks(reportPath, benchmark)}`,
        `- viewport：\`${markdownCell(requirement.comparison_meta.viewport || '')}\``,
        `- interaction_path：${requirement.comparison_meta.interaction_path.map(markdownCell).join(' → ') || '无'}`,
        `- sampled_at：${markdownCell(requirement.comparison_meta.sampled_at || '无')}`,
        `- high_priority_dimensions：${requirement.comparison_meta.high_priority_dimensions.map(markdownCell).join('、') || '无'}`,
        ...(requirement.comparison_meta.reference_protocol ? [
          `- reference_protocol：${markdownCell(requirement.comparison_meta.reference_protocol)}`,
          `- reference_scene_ids：${requirement.comparison_meta.reference_scene_ids.map(markdownCell).join('、')}`,
        ] : []),
        '',
      );
    }
  }
  lines.push(
    '',
    '## Criterion 评定',
    '',
    '| task | mode | 验证点 | 结论 | 具体理由 | evidence |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of reportRows(result)) {
    const evidence = rowEvidence(row, outputRoot);
    const cells = evidence.length ? evidence : [null];
    cells.forEach((item, index) => {
      lines.push(`| ${index === 0 ? markdownCell(row.requirement.taskId) : ''} | ${index === 0 ? markdownCell(row.requirement.judgeMode) : ''} | ${index === 0 ? markdownCell(`${row.validationId} ${row.item.criterion || ''}`) : ''} | ${index === 0 ? markdownCell(row.displayStatus) : ''} | ${index === 0 ? markdownCell(row.item.reason || row.requirement.reason) : ''} | ${markdownEvidenceItem(reportPath, item)} |`);
    });
  }
  lines.push('', '## 截图全集', '');
  const screenshots = screenshotArchive(result, outputRoot);
  if (!screenshots.length) {
    lines.push('无截图证据。', '');
  } else {
    screenshots.forEach((item, index) => {
      const href = portableRelative(reportPath, item.path);
      lines.push(`### ${index + 1}. ${item.label}`, '', `[查看原图](${href})`, '', `![${markdownCell(item.label)}](${href})`, '');
    });
  }
  writeFileSync(reportPath, `${lines.join('\n')}\n`);
}

function writeQuestionHtml(result, reportPath, outputRoot) {
  const lines = [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${htmlText(result.id)} 前端评测报告</title>`,
    '<style>:root{color-scheme:dark;--bg:#0b0f17;--panel:#111827;--head:#182131;--border:#303846;--text:#e5e7eb;--muted:#9aa4b2;--link:#7dd3fc}body{margin:24px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.55}table{border-collapse:collapse;width:100%;min-width:1100px;background:var(--panel)}th,td{border:1px solid var(--border);padding:8px 10px;vertical-align:top}th{background:var(--head);text-align:left}.wrap{overflow-x:auto}.evidence{min-width:520px}.evidence figure,.gallery figure{margin:0 0 12px}.evidence img,.gallery img{display:block;max-width:520px;width:100%;height:auto;border:1px solid var(--border)}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}.gallery figure{background:var(--panel);padding:12px;border:1px solid var(--border)}figcaption,.muted{color:var(--muted);font-size:13px}a{color:var(--link)}pre{max-width:520px;max-height:320px;overflow:auto;white-space:pre-wrap;background:#0f172a;padding:8px;border:1px solid var(--border)}</style>',
    '</head><body>',
    `<h1>${htmlText(result.id)} 前端评测报告</h1>`,
    '<ul>',
    `<li>题号：${htmlText(result.number)}</li>`,
    `<li>Excel 行：${htmlText(result.row)}</li>`,
    `<li>题型：${htmlText(result.profile || '未识别')}</li>`,
    `<li>页面 URL：${htmlText(result.pageUrl || result.finalUrl || result.url || '无')}</li>`,
    `<li>被测 workspace：<code>${htmlText(result.workspace || '')}</code></li>`,
    `<li>Benchmark：${result.benchmarkWorkspace ? `<code>${htmlText(result.benchmarkWorkspace)}</code>` : '无'}</li>`,
    `<li>task 汇总状态：<code>${htmlText(result.status)}</code></li>`,
    `<li>Pointwise：${result.pointwiseSummary.pass}/${result.pointwiseSummary.total} pass，${result.pointwiseSummary.fail} fail</li>`,
    `<li>Pairwise：${htmlText(pairwiseSummaryText(result.pairwiseSummary))}</li>`,
    `<li>构建与运行：${htmlText(result.buildAndRuntime.status)}；${htmlText(result.buildAndRuntime.reason)}</li>`,
    `<li>有效 Task 均分：${htmlText(scoreText(result.scoreSummary.effective_only.score))}，task 覆盖率 ${result.scoreSummary.effective_only.valid}/${result.scoreSummary.effective_only.total}</li>`,
    `<li>Task 均分（异常计零）：${htmlText(scoreText(result.scoreSummary.zero_fill.score))}，异常计分项 ${result.scoreSummary.zero_fill.exceptions}</li>`,
    '</ul>',
    '<h2>要求列表</h2><div class="wrap"><table><thead><tr><th>task</th><th>mode</th><th>task</th><th>criteria</th></tr></thead><tbody>',
  ];
  for (const requirement of result.requirementResults || []) {
    lines.push(`<tr><td>${htmlText(requirement.taskId)}</td><td>${htmlText(requirement.judgeMode)}</td><td>${htmlText(requirement.task)}</td><td>${htmlText(requirement.criteriaText)}</td></tr>`);
  }
  lines.push('</tbody></table></div>');
  const pairwise = pairwiseItems(result);
  if (pairwise.length) {
    lines.push('<h2>Pairwise GSB task级结论</h2>');
    for (const requirement of pairwise) {
      const tested = normalizeEvidence(requirement.evidence.tested, outputRoot);
      const benchmark = normalizeEvidence(requirement.evidence.benchmark, outputRoot);
      lines.push(
        `<h3>task ${htmlText(requirement.taskId)}: ${htmlText(requirement.gsb || requirement.status)}</h3>`,
        '<ul>',
        `<li>status：<code>${htmlText(requirement.status)}</code></li>`,
        `<li>gsb：<code>${htmlText(requirement.gsb ?? 'null')}</code></li>`,
        `<li>task_score：${htmlText(requirement.task_score ?? 'null')}</li>`,
        `<li>reason：${htmlText(requirement.reason.join('；') || '无')}</li>`,
        `<li>tested evidence：${htmlEvidenceLinks(reportPath, tested)}</li>`,
        `<li>benchmark evidence：${htmlEvidenceLinks(reportPath, benchmark)}</li>`,
        `<li>viewport：<code>${htmlText(requirement.comparison_meta.viewport || '')}</code></li>`,
        `<li>interaction_path：${htmlText(requirement.comparison_meta.interaction_path.join(' → ') || '无')}</li>`,
        `<li>sampled_at：${htmlText(requirement.comparison_meta.sampled_at || '无')}</li>`,
        `<li>high_priority_dimensions：${htmlText(requirement.comparison_meta.high_priority_dimensions.join('、') || '无')}</li>`,
        ...(requirement.comparison_meta.reference_protocol ? [
          `<li>reference_protocol：${htmlText(requirement.comparison_meta.reference_protocol)}</li>`,
          `<li>reference_scene_ids：${htmlText(requirement.comparison_meta.reference_scene_ids.join('、'))}</li>`,
        ] : []),
        '</ul>',
      );
    }
  }
  lines.push('<h2>Criterion 评定</h2><div class="wrap"><table><thead><tr><th>task</th><th>mode</th><th>criterion</th><th>结论</th><th>具体理由</th><th>evidence</th></tr></thead><tbody>');
  for (const row of reportRows(result)) {
    const evidence = rowEvidence(row, outputRoot);
    const cells = evidence.length ? evidence : [null];
    cells.forEach((item, index) => {
      const prefix = index === 0
        ? `<td rowspan="${cells.length}">${htmlText(row.requirement.taskId)}</td><td rowspan="${cells.length}">${htmlText(row.requirement.judgeMode)}</td><td rowspan="${cells.length}">${htmlText(`${row.validationId} ${row.item.criterion || ''}`)}</td><td rowspan="${cells.length}">${htmlText(row.displayStatus)}</td><td rowspan="${cells.length}">${htmlText(row.item.reason || row.requirement.reason)}</td>`
        : '';
      lines.push(`<tr>${prefix}<td class="evidence">${htmlEvidenceItem(reportPath, item)}</td></tr>`);
    });
  }
  lines.push('</tbody></table></div>', '<h2>截图全集</h2>');
  const screenshots = screenshotArchive(result, outputRoot);
  if (!screenshots.length) {
    lines.push('<p class="muted">无截图证据。</p>');
  } else {
    lines.push('<div class="gallery">');
    for (const item of screenshots) {
      const href = htmlAttribute(portableRelative(reportPath, item.path));
      lines.push(`<figure><a href="${href}"><img src="${href}" alt="${htmlAttribute(item.label)}"></a><figcaption>${htmlText(item.label)}</figcaption></figure>`);
    }
    lines.push('</div>');
  }
  lines.push('</body></html>');
  writeFileSync(reportPath, `${lines.join('\n')}\n`);
}

function writeSummaryMarkdown(results, reportPath) {
  const lines = [
    '# 前端自动评测汇总',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '| number | row | id | profile | status | pointwise | pairwise | 有效 Task 均分 | Task 均分（异常计零） | Markdown | HTML |',
    '| ---: | ---: | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |',
  ];
  for (const result of results) {
    lines.push(`| ${result.number} | ${result.row} | ${markdownCell(result.id)} | ${markdownCell(result.profile)} | ${result.status} | ${result.pointwiseSummary.pass}/${result.pointwiseSummary.total} | ${markdownCell(pairwiseSummaryText(result.pairwiseSummary))} | ${scoreText(result.scoreSummary.effective_only.score)} | ${scoreText(result.scoreSummary.zero_fill.score)} | [MD](${portableRelative(reportPath, result.reportPath)}) | [HTML](${portableRelative(reportPath, result.htmlReportPath)}) |`);
  }
  lines.push('');
  writeFileSync(reportPath, `${lines.join('\n')}\n`);
}

function writeSummaryHtml(results, reportPath) {
  const rows = results.map((result) => `<tr><td>${htmlText(result.number)}</td><td>${htmlText(result.row)}</td><td>${htmlText(result.id)}</td><td>${htmlText(result.profile)}</td><td>${htmlText(result.status)}</td><td>${result.pointwiseSummary.pass}/${result.pointwiseSummary.total}</td><td>${htmlText(pairwiseSummaryText(result.pairwiseSummary))}</td><td>${htmlText(scoreText(result.scoreSummary.effective_only.score))}</td><td>${htmlText(scoreText(result.scoreSummary.zero_fill.score))}</td><td><a href="${htmlAttribute(portableRelative(reportPath, result.reportPath))}">MD</a></td><td><a href="${htmlAttribute(portableRelative(reportPath, result.htmlReportPath))}">HTML</a></td></tr>`);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>前端自动评测汇总</title><style>:root{color-scheme:dark;--bg:#0b0f17;--panel:#111827;--head:#182131;--border:#303846;--text:#e5e7eb;--link:#7dd3fc}body{margin:24px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}table{border-collapse:collapse;width:100%;background:var(--panel)}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left}th{background:var(--head)}a{color:var(--link)}</style></head><body><h1>前端自动评测汇总</h1><table><thead><tr><th>number</th><th>row</th><th>id</th><th>profile</th><th>status</th><th>pointwise</th><th>pairwise</th><th>有效 Task 均分</th><th>Task 均分（异常计零）</th><th>Markdown</th><th>HTML</th></tr></thead><tbody>${rows.join('')}</tbody></table></body></html>
`;
  writeFileSync(reportPath, html);
}

export function writeEvaluationReports({ outputRoot, results }) {
  const root = resolve(outputRoot);
  const reportsRoot = ensureDirectory(join(root, 'reports'));
  const markdownRoot = ensureDirectory(join(reportsRoot, 'md'));
  const htmlRoot = ensureDirectory(join(reportsRoot, 'html'));
  const normalized = (Array.isArray(results) ? results : [results]).map((result) => {
    const reportKey = String(Number(result.row) || Number(result.number) || result.id);
    const paths = {
      markdown: join(markdownRoot, `${reportKey}-${result.id}-report.md`),
      html: join(htmlRoot, `${reportKey}-${result.id}-report.html`),
    };
    return normalizeResult(result, root, paths);
  });
  for (const result of normalized) {
    writeQuestionMarkdown(result, result.reportPath, root);
    writeQuestionHtml(result, result.htmlReportPath, root);
  }
  const summaryMarkdownPath = join(markdownRoot, 'eval-summary-report.md');
  const summaryHtmlPath = join(htmlRoot, 'eval-summary-report.html');
  const resultsPath = join(reportsRoot, 'eval-summary-results.json');
  writeSummaryMarkdown(normalized, summaryMarkdownPath);
  writeSummaryHtml(normalized, summaryHtmlPath);
  writeFileSync(resultsPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return {
    results: normalized,
    resultsPath,
    summaryMarkdownPath,
    summaryHtmlPath,
  };
}

export function validateEvaluationArtifacts({ outputRoot, results }) {
  const root = resolve(outputRoot);
  const missing = [];
  const evidenceMissing = [];
  const required = [
    join(root, 'reports/eval-summary-results.json'),
    join(root, 'reports/md/eval-summary-report.md'),
    join(root, 'reports/html/eval-summary-report.html'),
  ];
  for (const result of results || []) {
    required.push(result.reportPath, result.htmlReportPath);
    for (const requirement of result.requirementResults || []) {
      for (const item of [requirement, ...(requirement.criterionResults || [])]) {
        const evidenceItems = requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB
          ? pairwiseEvidenceItems(item.evidence, root)
          : normalizeEvidence(item.evidence, root);
        for (const evidence of evidenceItems) {
          if (!existsSync(evidence.path)) evidenceMissing.push(evidence.path);
        }
      }
    }
  }
  for (const path of required) {
    if (!path || !existsSync(path)) missing.push(path);
  }
  return {
    ok: missing.length === 0 && evidenceMissing.length === 0,
    missing: [...new Set(missing)],
    evidenceMissing: [...new Set(evidenceMissing)],
  };
}
