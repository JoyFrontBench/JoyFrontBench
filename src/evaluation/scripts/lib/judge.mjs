import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { assertDirectory, evaluationOutputRoot } from './config.mjs';
import {
  GSB_SCORES,
  JUDGE_MODE_PAIRWISE_GSB,
  isTaskStatus,
  normalizeGsb,
  parsePromptGroups,
} from './tasks.mjs';

function mdCell(value) {
  return String(value || '').replace(/\n/g, '<br>').replace(/\|/g, '\\|');
}

function htmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlText(value) {
  return htmlAttr(value).replace(/\n/g, '<br>');
}

function normalizeEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : evidence ? [evidence] : [])
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (typeof item.path === 'string') return item.path;
      return '';
    })
    .filter(Boolean);
}

function pairwiseEvidenceSides(evidence) {
  const isRecord = evidence && typeof evidence === 'object' && !Array.isArray(evidence);
  return {
    validShape: Boolean(isRecord && Array.isArray(evidence.tested) && Array.isArray(evidence.benchmark)),
    tested: normalizeEvidence(isRecord ? evidence.tested : evidence),
    benchmark: normalizeEvidence(isRecord ? evidence.benchmark : []),
  };
}

function isImagePath(path) {
  return /\.(png|jpg|jpeg|webp)$/iu.test(path);
}

function isMachineReadablePath(path) {
  return /\.(json|csv|txt|log|html|htm|js|jsx|ts|tsx|mjs|cjs|vue|svelte|css|scss|svg)$/iu.test(path);
}

function isDeterministicClaim(text) {
  return /CSV|JSON|导出|下载|上传|144|10\s*分钟|缺失|筛选|搜索|校验|发布|保存|禁用|停用|不可选择|按钮|点击|拖拽|联动|批量|状态|路由|跳转|localStorage|DOM|metadata|flow_values|cumulative_ratio/iu.test(text);
}

function isAutomatable(requirement) {
  const value = String(requirement?.automation || '').trim();
  return value === '1' || /自动|可自动/u.test(value);
}

function isAutoSplitOrParentDerived(reason) {
  return /父项|父任务综合结果|自动拆分|未配置专项断言|未配置独立断言|本轮仅有页面级截图\/DOM\s*证据|不能复用父项证据|缺少该校验点|专项自动化证据|原大项结论/u.test(String(reason || ''));
}

function isUnattemptedFlowReason(reason) {
  return /尚未检测到|未进入|未完成|未验证|未完整覆盖|尚未完整覆盖|仅有页面级截图|没有完整覆盖|需截图|需.*判断|需.*复核|需.*确认|属于视觉项.*截图|提供.*截图.*判定|按现有截图|按截图判定|按截图证据判定|按现有连续截图判定|按现有截图\/录屏证据判定|保留.*复核/u.test(String(reason || ''));
}

function isVisualStyleClaim(text) {
  return /视觉|风格|美观|美感|审美|电影感|霓虹|科幻|玻璃拟态|cel-shaded|卡通|描边|雾|氛围|字体|圆角|透明度|边框|配色|色彩|层级|焦点|清晰|辨识|过曝|Bloom|辉光|材质|光照|构图|留白|质感|协调/u.test(String(text || ''));
}

function isVisualOrLayoutClaim(text) {
  return isVisualStyleClaim(text) || /布局|比例|尺寸|缩放|自适应|裁切|错位|遮挡|溢出|空白|占位|色块|形态|展示效果/u.test(String(text || ''));
}

function isContinuousResult(result) {
  return /game|planet|rpg|demo|particle|shape|underwater|3d|canvas|webgl|animation/iu.test(`${result?.profile || ''} ${result?.id || ''}`);
}

function needsSequenceEvidence(text) {
  return /平滑|连续|实时|不卡顿|不突兀|拖拽|滑动|滚动|动画|轮播|移动|跳跃|回落|相机|跟随|追逐|AI|碰撞|阶段|爆炸|水柱|坍缩|余波|变形|切换|旋转|缩放|hover|active/iu.test(String(text || ''));
}

function imageContents(paths) {
  return paths
    .filter((path) => isImagePath(path) && existsSync(path))
    .map((path) => readFileSync(path))
    .sort(Buffer.compare);
}

function hasDuplicateImageContent(paths) {
  const images = imageContents(paths);
  return images.some((image, index) => index > 0 && image.equals(images[index - 1]));
}

function hasMachineReadableEvidence(paths) {
  return paths.some((path) => isMachineReadablePath(path));
}

function uniqueImageCount(paths) {
  const images = imageContents(paths);
  return images.filter((image, index) => index === 0 || !image.equals(images[index - 1])).length;
}

function issueKey(issue) {
  return [issue.severity, issue.id, issue.taskId, issue.scope, issue.message].join('\u0001');
}

function addIssue(issues, severity, result, taskId, scope, message, action) {
  issues.push({
    severity,
    id: result?.id || '',
    row: result?.row || '',
    taskId: taskId || '',
    scope,
    message,
    action,
  });
}

function checkEvidence(issues, result, taskId, scope, status, text, evidence, options = {}) {
  if (!['pass', 'fail', 'blocked/network', 'error'].includes(String(status || '').trim())) {
    addIssue(issues, 'high', result, taskId, scope, `Unsupported non-final status: ${status || '(empty)'}.`, 'Use pass/fail directly, or blocked/network only for navigation failure.');
  }
  const paths = normalizeEvidence(evidence);
  if (status === 'pass' && !paths.length) {
    addIssue(issues, 'high', result, taskId, scope, 'pass verdict has no evidence.', 'Add concrete evidence or mark the item fail.');
  }
  for (const evidencePath of paths) {
    if (!existsSync(evidencePath)) {
      addIssue(issues, 'high', result, taskId, scope, `Evidence path does not exist: ${evidencePath}`, 'Regenerate the artifact or remove the broken evidence link.');
    }
  }
  if (status === 'pass' && isDeterministicClaim(text) && !isVisualStyleClaim(text)) {
    const hasMachineReadable = paths.some((path) => isMachineReadablePath(path));
    if (!hasMachineReadable) {
      addIssue(
        issues,
        options.strict ? 'high' : 'medium',
        result,
        taskId,
        scope,
        'Deterministic pass is supported only by screenshots.',
        'Add DOM/data/download/localStorage evidence, or mark the item fail.'
      );
    }
  }
}

function checkReportLinks(issues, result) {
  if (!result.reportPath || !existsSync(result.reportPath)) {
    addIssue(issues, 'high', result, '', 'report', 'Per-question report file is missing.', 'Rerun evaluator or rewrite reports.');
    return;
  }
  const text = readFileSync(result.reportPath, 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const raw = match[1].trim();
    if (/^(https?:|#)/iu.test(raw)) continue;
    if (/^(file:|\/Users\/|\/tmp\/|\/var\/)/u.test(raw)) {
      addIssue(issues, 'high', result, '', 'report', `Report uses non-relative Markdown link: ${raw}`, 'Use relative report links so Typora can render artifacts.');
      continue;
    }
    const abs = resolve(dirname(result.reportPath), raw);
    if (!existsSync(abs)) {
      addIssue(issues, 'high', result, '', 'report', `Markdown link target is missing: ${raw}`, 'Regenerate artifact or fix the relative link.');
    }
  }
}

function checkEvidencePaths(issues, result, taskId, scope, paths) {
  for (const evidencePath of paths) {
    if (!existsSync(evidencePath)) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        scope,
        `Evidence path does not exist: ${evidencePath}`,
        'Regenerate the artifact or remove the broken evidence link.',
      );
    }
  }
}

function auditTaskContractIssues(issues, result, item, taskId) {
  for (const field of ['judge', 'originalJudge', 'judgeSource', 'subResults']) {
    if (Object.hasOwn(item, field)) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'contract',
        `Unsupported legacy result field ${field} is present.`,
        `Remove ${field} and emit only the criteria/criterionResults contract.`,
      );
    }
  }
  for (const message of Array.isArray(item.contractIssues) ? item.contractIssues : []) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'contract',
      String(message),
      'Rerun the affected task and emit the current result contract without legacy fields or coercion.',
    );
  }
}

function auditPointwiseTaskContract(issues, result, item, taskId) {
  auditTaskContractIssues(issues, result, item, taskId);
  if (!['completed', 'blocked'].includes(String(item.status || '').trim())) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'requirement',
      `Invalid pointwise task status: ${item.status || '(empty)'}.`,
      'Use completed when all leaves are pass/fail, or blocked when a leaf is blocked/network or error.',
    );
  }
  for (const field of ['gsb', 'pairwiseVerdict', 'comparison_meta']) {
    if (Object.hasOwn(item, field) && item[field] !== undefined && item[field] !== null) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'contract',
        `Pointwise task carries pairwise-only field ${field}.`,
        `Remove ${field} and derive the pointwise score only from leaf pass/fail results.`,
      );
    }
  }
  const criteria = Array.isArray(item.criterionResults) ? item.criterionResults : [];
  const expectedStatus = criteria.length && criteria.every((criterion) => ['pass', 'fail'].includes(String(criterion.status || '').trim()))
    ? 'completed'
    : 'blocked';
  if (item.status !== expectedStatus) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'requirement',
      `Pointwise task status disagrees with leaf results: expected=${expectedStatus}, actual=${item.status}.`,
      'Recompute the task status from the authoritative criterion statuses.',
    );
  }
  const expectedScore = expectedStatus === 'completed' && criteria.length
    ? criteria.filter((criterion) => criterion.status === 'pass').length / criteria.length
    : null;
  if (expectedScore === null) {
    if (item.task_score !== null) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'scoring',
        `Blocked pointwise task must use task_score=null, got ${item.task_score}.`,
        'Leave task_score null and let final scoring apply effective_only/zero_fill.',
      );
    }
  } else if (!Number.isFinite(Number(item.task_score)) || Math.abs(Number(item.task_score) - expectedScore) > 1e-9) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'scoring',
      `Pointwise task_score mismatch: expected=${expectedScore}, actual=${item.task_score}.`,
      'Recompute task_score from equally weighted criteria.',
    );
  }
}

function auditPairwiseEvidence(issues, result, taskId, scope, evidence, status, requireBlockedEvidence = false) {
  const sides = pairwiseEvidenceSides(evidence);
  if (!sides.validShape) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      scope,
      'Pairwise evidence must be an object with tested[] and benchmark[] arrays.',
      'Record both sides separately instead of using a single shared evidence list.',
    );
  }
  if (status !== 'blocked' && (!sides.tested.length || !sides.benchmark.length)) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      scope,
      `${status || 'completed'} pairwise result lacks evidence from both sides.`,
      'Capture comparable tested and benchmark evidence using the same viewport and interaction path.',
    );
  }
  if (status === 'blocked' && requireBlockedEvidence && !sides.tested.length && !sides.benchmark.length) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      scope,
      'Blocked pairwise result has no launch or blocking evidence.',
      'Attach the available side or launch-failure artifact so the blocked state is auditable.',
    );
  }
  checkEvidencePaths(issues, result, taskId, scope, [...sides.tested, ...sides.benchmark]);
  return sides;
}

function auditPairwiseRequirement(issues, result, requirement, item, criteria) {
  const taskId = String(requirement.taskId || '');
  auditTaskContractIssues(issues, result, item, taskId);
  if (Object.hasOwn(item, 'pairwiseVerdict')) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'contract',
      'Legacy pairwiseVerdict is present.',
      'Replace pairwiseVerdict with the single task-level gsb field.',
    );
  }
  const status = String(item.status || '').trim().toLowerCase();
  if (!isTaskStatus(status)) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'requirement',
      `Invalid pairwise status: ${item.status || '(empty)'}.`,
      'Use completed, blocked, or needs_review.',
    );
  }
  const gsb = normalizeGsb(item.gsb);
  if (status === 'completed') {
    if (!gsb) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'scoring',
        'Completed pairwise task does not carry exactly one valid G/S/B.',
        'Rerun the comparison and emit one task-level gsb value.',
      );
    } else if (!Number.isFinite(Number(item.task_score)) || Math.abs(Number(item.task_score) - GSB_SCORES[gsb]) > 1e-9) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'scoring',
        `Pairwise task_score mismatch for ${gsb}: expected=${GSB_SCORES[gsb]}, actual=${item.task_score}.`,
        'Use the fixed G=1, S=0.5, B=0 mapping.',
      );
    }
  } else {
    if (item.gsb !== null) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'scoring',
        `${status || 'Non-completed'} pairwise task must use gsb=null.`,
        'Do not convert an unresolved comparison into G/S/B.',
      );
    }
    if (item.task_score !== null) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'scoring',
        `${status || 'Non-completed'} pairwise task must use task_score=null.`,
        'Leave the score null and let final scoring apply the exception policy.',
      );
    }
  }
  const reason = Array.isArray(item.reason)
    ? item.reason.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (!Array.isArray(item.reason) || reason.length < 1 || reason.length > 2) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'requirement',
      'Pairwise reason must contain 1–2 concrete relative-difference observations.',
      'Write a short reason array tied to observable high-priority differences.',
    );
  }
  auditPairwiseEvidence(issues, result, taskId, 'requirement', item.evidence, status, true);
  const meta = item.comparison_meta;
  const validMeta = meta && typeof meta === 'object' && !Array.isArray(meta);
  if (!validMeta) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'comparison_meta',
      'Pairwise comparison_meta is missing or invalid.',
      'Record viewport, interaction_path, sampled_at, and high_priority_dimensions.',
    );
  } else {
    if (!String(meta.viewport || '').trim()) {
      addIssue(issues, 'high', result, taskId, 'comparison_meta', 'comparison_meta.viewport is empty.', 'Record the actual shared viewport.');
    }
    if (!Array.isArray(meta.interaction_path) || !meta.interaction_path.length) {
      addIssue(issues, 'high', result, taskId, 'comparison_meta', 'comparison_meta.interaction_path is empty.', 'Record the identical operation path used on both sides.');
    }
    if (!String(meta.sampled_at || '').trim()) {
      addIssue(issues, 'high', result, taskId, 'comparison_meta', 'comparison_meta.sampled_at is empty.', 'Record the comparable sampling moment.');
    }
    if (status !== 'blocked' && (!Array.isArray(meta.high_priority_dimensions) || !meta.high_priority_dimensions.length)) {
      addIssue(issues, 'high', result, taskId, 'comparison_meta', 'comparison_meta.high_priority_dimensions is empty.', 'Select the high-priority dimensions from the task text before deciding G/S/B.');
    }
  }
  const criterionResults = Array.isArray(item.criterionResults) ? item.criterionResults : [];
  if (criterionResults.length !== criteria.length) {
    addIssue(
      issues,
      'high',
      result,
      taskId,
      'criteria',
      `Pairwise criteria coverage mismatch: expected=${criteria.length}, actual=${criterionResults.length}.`,
      'Provide one criterionResult for each authoritative criterion.',
    );
  }
  for (let index = 0; index < criteria.length; index += 1) {
    const expectedId = requirement.criterionIds[index];
    const criterionResult = criterionResults.find((value) => String(value.criterionId || '') === expectedId)
      || criterionResults[index];
    if (!criterionResult) continue;
    if (String(criterionResult.criterionId || '') !== expectedId) {
      addIssue(issues, 'high', result, expectedId, 'criterion', `Pairwise criterion id mismatch: expected=${expectedId}, actual=${criterionResult.criterionId || '(empty)'}.`, 'Keep criterion numbering one-to-one and in source order.');
    }
    if (Object.hasOwn(criterionResult, 'taskId') || Object.hasOwn(criterionResult, 'task')) {
      addIssue(issues, 'high', result, expectedId, 'contract', 'Pairwise criterion uses unsupported legacy fields taskId/task.', 'Use criterionId and criterion.');
    }
    for (const field of ['status', 'gsb', 'pairwiseVerdict', 'task_score']) {
      if (Object.hasOwn(criterionResult, field) && criterionResult[field] !== undefined && criterionResult[field] !== null) {
        addIssue(
          issues,
          'high',
          result,
          expectedId,
          'contract',
          `Pairwise criterion carries forbidden scoring field ${field}.`,
          'Keep criterion rows as comparison dimensions and evidence only.',
        );
      }
    }
    if (!String(criterionResult.reason || '').trim() || isAutoSplitOrParentDerived(criterionResult.reason)) {
      addIssue(
        issues,
        'high',
        result,
        expectedId,
        'criterion',
        'Pairwise criterion lacks a concrete dimension-specific observation.',
        'Describe what was observed on both sides for this comparison dimension.',
      );
    }
    auditPairwiseEvidence(issues, result, expectedId, 'criterion', criterionResult.evidence, status);
  }
}

function auditBuildAndRuntime(issues, result) {
  const runtime = result.buildAndRuntime;
  const issue = (message) => addIssue(issues, 'high', result, '', 'runtime', message,
    'Verify the build, launch, and browser access; attach current runtime logs.');
  if (!runtime || !['passed', 'failed'].includes(runtime.status)) {
    issue('Build-and-runtime contract is missing or unverified.');
    return;
  }
  if (typeof runtime.reason !== 'string' || !runtime.reason.trim()) issue('Build-and-runtime verdict has no explanation.');
  if (!Array.isArray(runtime.evidence) || !runtime.evidence.length
    || runtime.evidence.some((path) => typeof path !== 'string' || !path.trim())) {
    issue('Build-and-runtime verdict requires an array of evidence paths.');
    return;
  }
  if (!runtime.evidence.some((path) => /\.(json|log|txt|har)$/iu.test(path))) {
    issue('Build-and-runtime verdict requires execution logs, not source inspection or screenshots alone.');
  }
  for (const path of runtime.evidence) {
    if (!existsSync(path) || !statSync(path).isFile()) issue(`Runtime evidence file does not exist: ${path}`);
  }
}

function auditResultAgainstGroup(issues, result, group, options) {
  if (!result) {
    addIssue(issues, 'high', { id: group.id, row: group.row }, '', 'group', 'Selected source group has no result.', 'Run evaluator for this id.');
    return;
  }
  auditBuildAndRuntime(issues, result);
  if (String(result.url || '').replace(/\/$/u, '') !== String(group.testedUrl || '').replace(/\/$/u, '')) {
    addIssue(issues, 'high', result, '', 'group', 'Result URL does not match the selected tested URL.', 'Rerun evaluator with the current tested URL.');
  }
  if (!Array.isArray(result.requirementResults)) {
    addIssue(issues, 'high', result, '', 'group', 'Result has no requirementResults array.', 'Rerun evaluator.');
    return;
  }
  if (result.requirementResults.length !== group.requirements.length) {
    addIssue(
      issues,
      'high',
      result,
      '',
      'group',
      `Requirement count mismatch. source=${group.requirements.length}, result=${result.requirementResults.length}.`,
      'Rerun evaluator and verify every source requirement is included.'
    );
  }

  const byTaskId = new Map(result.requirementResults.map((item) => [String(item.taskId || ''), item]));
  for (const requirement of group.requirements) {
    const taskId = String(requirement.taskId || '');
    const item = byTaskId.get(taskId);
    if (!item) {
      addIssue(issues, 'high', result, taskId, 'requirement', 'Source requirement is missing from result.', 'Rerun evaluator with the current task repository.');
      continue;
    }
    const criteria = requirement.criteria;
    if (String(item.judgeMode || '') !== String(requirement.judgeMode || '')) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'contract',
        `judge_mode mismatch: source=${requirement.judgeMode}, result=${item.judgeMode || '(empty)'}.`,
        'Use the authoritative judge_mode from the prompt repository.',
      );
    }
    if (requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB) {
      auditPairwiseRequirement(issues, result, requirement, item, criteria);
      continue;
    }
    auditPointwiseTaskContract(issues, result, item, taskId);
    const criterionResults = Array.isArray(item.criterionResults) ? item.criterionResults : [];
    if (!criterionResults.length) {
      const itemText = `${item.task || ''}\n${item.criteriaText || requirement.criteriaText || ''}`;
      checkEvidence(issues, result, taskId, 'requirement', item.status, itemText, item.evidence, options);
    }
    if (criteria.length > 1 && !criterionResults.length) {
      const severity = item.status === 'pass' || options.strict ? 'high' : 'medium';
      addIssue(
        issues,
        severity,
        result,
        taskId,
        'criteria',
        `criteria contains ${criteria.length} items but no independent criterionResults.`,
        'Add targeted checks for each criterion, or keep unsupported criteria as fail.'
      );
    } else if (criteria.length > 1 && criterionResults.length < criteria.length) {
      addIssue(
        issues,
        options.strict ? 'high' : 'medium',
        result,
        taskId,
        'criteria',
        `criteria contains ${criteria.length} items but only ${criterionResults.length} criterionResults.`,
        'Review whether every criterion is independently covered.'
      );
    }

    const expectedCriterionIds = new Set(requirement.criterionIds);
    const seenCriterionIds = new Set();
    for (const criterionResult of criterionResults) {
      const criterionId = String(criterionResult?.criterionId || '');
      if (seenCriterionIds.has(criterionId)) {
        addIssue(issues, 'high', result, criterionId || taskId, 'criterion', `Duplicate criterion id: ${criterionId || '(empty)'}.`, 'Emit every criterion exactly once.');
      }
      seenCriterionIds.add(criterionId);
      if (!expectedCriterionIds.has(criterionId)) {
        addIssue(issues, 'high', result, criterionId || taskId, 'criterion', `Unknown criterion id: ${criterionId || '(empty)'}.`, 'Use the authoritative criterionId values in source order.');
      }
    }
    criteria.forEach((criterion, index) => {
      const expectedId = requirement.criterionIds[index];
      const criterionResult = criterionResults.find((value) => String(value?.criterionId || '') === expectedId);
      if (!criterionResult) return;
      if (String(criterionResult.criterion || '').trim() !== String(criterion).trim()) {
        addIssue(issues, 'high', result, expectedId, 'criterion', 'Criterion text does not match the prompt repository.', 'Use the authoritative criterion text without rewriting it.');
      }
    });

    const evidenceGroups = [];
    const autoSplitCriterionIds = [];
    const lazyReasonCriterionIds = [];
    const isContinuous = isContinuousResult(result);
    for (const criterionResult of criterionResults) {
      const criterionId = criterionResult.criterionId || taskId;
      if (Object.hasOwn(criterionResult, 'taskId') || Object.hasOwn(criterionResult, 'task')) {
        addIssue(issues, 'high', result, criterionId, 'contract', 'Criterion uses unsupported legacy fields taskId/task.', 'Use criterionId and criterion.');
      }
      const criterionText = `${criterionResult.criterion || ''}\n${criterionResult.reason || ''}`;
      checkEvidence(issues, result, criterionId, 'criterion', criterionResult.status, criterionText, criterionResult.evidence, options);
      if (isAutoSplitOrParentDerived(criterionResult.reason)) {
        autoSplitCriterionIds.push(criterionResult.criterionId || '');
      }
      if (isUnattemptedFlowReason(criterionResult.reason)) {
        lazyReasonCriterionIds.push(criterionResult.criterionId || '');
      }
      const paths = normalizeEvidence(criterionResult.evidence);
      if (options.strict && String(criterionResult.status || '').trim() === 'pass' && isContinuous && needsSequenceEvidence(`${criterionResult.criterion || ''}\n${requirement.task || ''}\n${requirement.criteriaText || ''}`)) {
        const imageCount = uniqueImageCount(paths);
        const hasData = hasMachineReadableEvidence(paths);
        if (imageCount < 2 && !hasData) {
          addIssue(
            issues,
            'high',
            result,
            criterionId,
            'criterion',
            `Continuous/game criterion has insufficient sequence evidence: unique screenshots=${imageCount}, machine-readable evidence=${hasData}.`,
            'Capture before/during/after frames or attach time-series/state-sampling data for this criterion.'
          );
        }
      }
      if (
        criterionResult.status === 'pass' &&
        hasDuplicateImageContent(paths) &&
        needsSequenceEvidence(criterionText) &&
        !hasMachineReadableEvidence(paths) &&
        !/无变化|未变化|没有变化|完全相同/u.test(String(criterionResult.reason || ''))
      ) {
        addIssue(
          issues,
          'high',
          result,
          criterionId,
          'criterion',
          'Pass criterion contains duplicate screenshot content within its evidence.',
          'Use distinct before/after evidence or downgrade the criterion.'
        );
      }
      const images = imageContents(paths);
      if (images.length) {
        const existing = evidenceGroups.find((group) => group.images.length === images.length
          && images.every((image, index) => image.equals(group.images[index])));
        if (existing) existing.criterionIds.push(criterionResult.criterionId || '');
        else evidenceGroups.push({ images, criterionIds: [criterionResult.criterionId || ''] });
      }
      if (criterionResult.status === 'pass' && isAutoSplitOrParentDerived(criterionResult.reason)) {
        addIssue(issues, 'high', result, criterionId, 'criterion', 'Auto-split or parent-derived criterion is marked pass.', 'Add an independent check or mark it fail.');
      }
    }
    if (options.strict && autoSplitCriterionIds.length) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'criteria',
        `Criteria were only auto-split or parent-derived: ${autoSplitCriterionIds.join(', ')}.`,
        'Replace auto-split placeholders with targeted checks and concrete evidence.'
      );
    }
    if (options.strict && lazyReasonCriterionIds.length) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'criteria',
        `Criteria use unattempted or screenshot-only wording: ${lazyReasonCriterionIds.join(', ')}.`,
        'Replace vague coverage language with a concrete interaction/assertion result for each criterion.'
      );
    }
    if (options.strict && isAutomatable(requirement) && isUnattemptedFlowReason(item.reason) && criterionResults.some((criterion) => isAutoSplitOrParentDerived(criterion.reason))) {
      addIssue(
        issues,
        'high',
        result,
        taskId,
        'requirement',
        'Automatable requirement uses unattempted-flow language while criteria are placeholders.',
        'Run the specified flow and record exact pass/fail evidence for each criterion.'
      );
    }
    for (const { criterionIds } of evidenceGroups) {
      if (criterionIds.length > 1) {
        const anyPass = criterionResults.some((criterion) => criterionIds.includes(criterion.criterionId || '') && criterion.status === 'pass');
        const selectedCriteria = criterionResults.filter((criterion) => criterionIds.includes(criterion.criterionId || ''));
        const allHaveData = criterionResults
          .filter((criterion) => criterionIds.includes(criterion.criterionId || ''))
          .every((criterion) => hasMachineReadableEvidence(normalizeEvidence(criterion.evidence)));
        if (allHaveData) continue;
        if (selectedCriteria.every((criterion) => isVisualOrLayoutClaim(`${criterion.criterion || ''}\n${requirement.task || ''}`))) continue;
        if (!isContinuous && !anyPass) continue;
        addIssue(
          issues,
          isContinuous || (options.strict && anyPass) ? 'high' : 'medium',
          result,
          taskId,
          'criterion',
          `Identical screenshot content reused by criteria: ${criterionIds.join(', ')}.`,
          'Use criterion-specific evidence, or explain why the same screenshot content directly proves every listed criterion.'
        );
      }
    }
  }
  checkReportLinks(issues, result);
}

function writeJudgeReport(issues, selectedGroups, results, options) {
  const mdReportRoot = join(options.reportRoot, 'md');
  const htmlReportRoot = join(options.reportRoot, 'html');
  mkdirSync(mdReportRoot, { recursive: true });
  mkdirSync(htmlReportRoot, { recursive: true });
  const suffix = options.strict ? '-strict' : '';
  const judgeReportPath = join(mdReportRoot, `eval-judge-report${suffix}.md`);
  const judgeHtmlPath = join(htmlReportRoot, `eval-judge-report${suffix}.html`);
  const judgeJsonPath = join(options.reportRoot, `eval-judge-results${suffix}.json`);
  const uniqueIssues = [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const issue of uniqueIssues) counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  const status = counts.high ? 'invalid' : counts.medium ? 'needs-followup' : 'pass';
  const lines = [];
  lines.push('# Eval Judge Report');
  lines.push('');
  lines.push(`- Judge status: ${status}`);
  lines.push(`- Strict mode: ${options.strict ? 'yes' : 'no'}`);
  lines.push(`- Selected source groups: ${selectedGroups.length}`);
  lines.push(`- Result groups: ${results.length}`);
  lines.push(`- Issues: high=${counts.high || 0}, medium=${counts.medium || 0}, low=${counts.low || 0}`);
  lines.push('');
  lines.push('## Issue Table');
  lines.push('');
  lines.push('| severity | id | task | scope | issue | next action |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  if (!uniqueIssues.length) {
    lines.push('| - | - | - | - | No judge issues found. | - |');
  } else {
    for (const issue of uniqueIssues) {
      lines.push(`| ${issue.severity} | ${issue.id || ''} | ${issue.taskId || ''} | ${issue.scope} | ${mdCell(issue.message)} | ${mdCell(issue.action)} |`);
    }
  }
  lines.push('');
  lines.push('## Per-Question Summary');
  lines.push('');
  lines.push('| id | row | result status | requirement count | judge issues | report |');
  lines.push('| --- | ---: | --- | ---: | ---: | --- |');
  for (const group of selectedGroups) {
    const result = results.find((item) => item.id === group.id && Number(item.row) === Number(group.row));
    const issueCount = uniqueIssues.filter((issue) => issue.id === group.id && Number(issue.row) === Number(group.row)).length;
    const reportLink = result?.reportPath && existsSync(result.reportPath)
      ? `[report](${relative(dirname(judgeReportPath), result.reportPath).replace(/\\/g, '/')})`
      : 'missing';
    lines.push(`| ${group.id} | ${group.row} | ${result?.status || 'missing'} | ${group.requirements.length} | ${issueCount} | ${reportLink} |`);
  }
  lines.push('');
  lines.push('## Judge Policy');
  lines.push('');
  lines.push('- A pass must have concrete, existing evidence.');
  lines.push('- Data/DOM/export/code claims need deterministic source/DOM/data/state evidence, not only screenshots.');
  lines.push('- Each criterion must be independently tested; unsupported criteria should stay fail.');
  lines.push('- Parent evidence reuse is treated as a coverage gap, not as proof.');
  lines.push('- Parent requirement status is treated as a summary; strict scoring focuses on criteria.');
  lines.push('- In strict mode, automatable criteria cannot remain auto-split placeholders.');
  lines.push('- In strict mode, repeated screenshot content and unattempted-flow wording are coverage failures.');
  lines.push('- Game, canvas, 3D, animation, and other continuous-interaction criteria need sequence evidence: multiple frames or machine-readable time-series/state samples.');
  lines.push('- Business software criteria may rely more on DOM/data/source assertions; they do not need many screenshots when deterministic evidence is strong.');
  writeFileSync(judgeReportPath, `${lines.join('\n')}\n`);
  writeJudgeHtmlReport(judgeHtmlPath, uniqueIssues, selectedGroups, results, options, status, counts);
  writeFileSync(judgeJsonPath, `${JSON.stringify({ status, counts, issues: uniqueIssues }, null, 2)}\n`);
  return { status, counts, issues: uniqueIssues, reportPath: judgeReportPath, htmlReportPath: judgeHtmlPath, jsonPath: judgeJsonPath };
}

function writeJudgeHtmlReport(judgeHtmlPath, uniqueIssues, selectedGroups, results, options, status, counts) {
  const lines = [];
  lines.push('<!doctype html>');
  lines.push('<html lang="zh-CN">');
  lines.push('<head>');
  lines.push('<meta charset="utf-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  lines.push('<title>Eval Judge Report</title>');
  lines.push('<style>');
  lines.push(':root{color-scheme:dark;--border:#303846;--muted:#9aa4b2;--bg:#0b0f17;--panel:#111827;--head:#182131;--text:#e5e7eb;--link:#7dd3fc;}');
  lines.push('body{margin:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);line-height:1.55;background:var(--bg);}');
  lines.push('h1{font-size:28px;margin:0 0 16px;}h2{font-size:20px;margin:28px 0 12px;}table{border-collapse:collapse;width:100%;min-width:980px;background:var(--panel);}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top;}th{background:var(--head);}a{color:var(--link);text-decoration:none;}a:hover{text-decoration:underline;}.wrap{overflow-x:auto;}.high{color:#fb7185;font-weight:700}.medium{color:#fbbf24;font-weight:700}.low{color:#93c5fd;font-weight:700}');
  lines.push('</style>');
  lines.push('</head>');
  lines.push('<body>');
  lines.push('<h1>Eval Judge Report</h1>');
  lines.push('<ul>');
  lines.push(`<li>Judge status: ${htmlText(status)}</li>`);
  lines.push(`<li>Strict mode: ${options.strict ? 'yes' : 'no'}</li>`);
  lines.push(`<li>Selected source groups: ${selectedGroups.length}</li>`);
  lines.push(`<li>Result groups: ${results.length}</li>`);
  lines.push(`<li>Issues: high=${counts.high || 0}, medium=${counts.medium || 0}, low=${counts.low || 0}</li>`);
  lines.push('</ul>');
  lines.push('<h2>Issue Table</h2>');
  lines.push('<div class="wrap"><table>');
  lines.push('<thead><tr><th>severity</th><th>id</th><th>task</th><th>scope</th><th>issue</th><th>next action</th></tr></thead>');
  lines.push('<tbody>');
  if (!uniqueIssues.length) {
    lines.push('<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>No judge issues found.</td><td>-</td></tr>');
  } else {
    for (const issue of uniqueIssues) {
      lines.push(`<tr><td class="${htmlAttr(issue.severity)}">${htmlText(issue.severity)}</td><td>${htmlText(issue.id || '')}</td><td>${htmlText(issue.taskId || '')}</td><td>${htmlText(issue.scope)}</td><td>${htmlText(issue.message)}</td><td>${htmlText(issue.action)}</td></tr>`);
    }
  }
  lines.push('</tbody></table></div>');
  lines.push('<h2>Per-Question Summary</h2>');
  lines.push('<div class="wrap"><table>');
  lines.push('<thead><tr><th>id</th><th>row</th><th>result status</th><th>requirement count</th><th>judge issues</th><th>report</th></tr></thead>');
  lines.push('<tbody>');
  for (const group of selectedGroups) {
    const result = results.find((item) => item.id === group.id && Number(item.row) === Number(group.row));
    const issueCount = uniqueIssues.filter((issue) => issue.id === group.id && Number(issue.row) === Number(group.row)).length;
    const reportLink = result?.htmlReportPath && existsSync(result.htmlReportPath)
      ? `<a href="${htmlAttr(relative(dirname(judgeHtmlPath), result.htmlReportPath).replace(/\\/g, '/'))}">HTML</a>`
      : result?.reportPath && existsSync(result.reportPath)
        ? `<a href="${htmlAttr(relative(dirname(judgeHtmlPath), result.reportPath).replace(/\\/g, '/'))}">MD</a>`
        : 'missing';
    lines.push(`<tr><td>${htmlText(group.id)}</td><td>${htmlText(group.row)}</td><td>${htmlText(result?.status || 'missing')}</td><td>${group.requirements.length}</td><td>${issueCount}</td><td>${reportLink}</td></tr>`);
  }
  lines.push('</tbody></table></div>');
  lines.push('<h2>Judge Policy</h2>');
  lines.push('<ul>');
  for (const item of [
    'A pass must have concrete, existing evidence.',
    'Data/DOM/export/code claims need deterministic source/DOM/data/state evidence, not only screenshots.',
    'Each criterion must be independently tested; unsupported criteria should stay fail.',
    'Parent evidence reuse is treated as a coverage gap, not as proof.',
    'Parent requirement status is treated as a summary; strict scoring focuses on criteria.',
    'In strict mode, automatable criteria cannot remain auto-split placeholders.',
    'In strict mode, repeated screenshot content and unattempted-flow wording are coverage failures.',
    'Game, canvas, 3D, animation, and other continuous-interaction criteria need sequence evidence: multiple frames or machine-readable time-series/state samples.',
    'Business software criteria may rely more on DOM/data/source assertions; they do not need many screenshots when deterministic evidence is strong.',
  ]) {
    lines.push(`<li>${htmlText(item)}</li>`);
  }
  lines.push('</ul>');
  lines.push('</body></html>');
  writeFileSync(judgeHtmlPath, `${lines.join('\n')}\n`);
  return judgeHtmlPath;
}

export function runJudge(options) {
  const args = { ids: new Set(), rows: new Set(), strict: false, ...options };
  const promptsRoot = assertDirectory(args.promptsRoot, '--prompts');
  args.reportRoot = resolve(args.reportRoot || join(evaluationOutputRoot, 'reports'));
  args.resultsPath = resolve(args.resultsPath || join(args.reportRoot, 'eval-summary-results.json'));
  const testedUrlOverride = args.testedUrlOverride || '';
  if (!existsSync(args.resultsPath)) throw new Error(`Missing results file: ${args.resultsPath}`);
  const allGroups = parsePromptGroups(promptsRoot).groups;
  const groupsById = new Map(allGroups.map((group) => [group.id, group]));
  const selectedGroups = allGroups.filter((group) => {
    if (args.ids.size && !args.ids.has(group.id)) return false;
    if (args.rows.size && !args.rows.has(Number(group.row))) return false;
    return true;
  });
  const allResults = JSON.parse(readFileSync(args.resultsPath, 'utf8'));
  const selectedResults = allResults.filter((result) => {
    if (args.ids.size && !args.ids.has(result.id)) return false;
    if (args.rows.size && !args.rows.has(groupsById.get(result.id)?.number)) return false;
    return true;
  }).map((result) => {
    const group = groupsById.get(result.id);
    return group ? { ...result, row: group.number } : result;
  });
  if (testedUrlOverride) {
    if (selectedGroups.length !== 1) {
      throw new Error(
        `--url requires exactly one selected group; selected=${selectedGroups.length}. Use --id or --row.`,
      );
    }
    selectedGroups[0].testedUrl = testedUrlOverride;
  } else {
    for (const group of selectedGroups) {
      const result = selectedResults.find(
        (item) => item.id === group.id && Number(item.row) === Number(group.row),
      );
      if (result?.url) group.testedUrl = result.url;
    }
  }

  const issues = [];
  for (const group of selectedGroups) {
    const result = selectedResults.find((item) => item.id === group.id && Number(item.row) === Number(group.row));
    auditResultAgainstGroup(issues, result, group, args);
  }
  for (const result of selectedResults) {
    const group = selectedGroups.find((item) => item.id === result.id && Number(item.row) === Number(result.row));
    if (!group) addIssue(issues, 'medium', result, '', 'group', 'Result exists but is not selected by the current source/filters.', 'Remove stale result or verify filters.');
  }

  return writeJudgeReport(issues, selectedGroups, selectedResults, args);
}
