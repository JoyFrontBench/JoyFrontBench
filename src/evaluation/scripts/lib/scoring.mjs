import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { assertDirectory, evaluationRoot as projectRoot } from './config.mjs';
import {
  GSB_SCORES,
  JUDGE_MODE_PAIRWISE_GSB,
  normalizeGsb,
  parsePromptGroups,
} from './tasks.mjs';
import { summarizeReferenceCohort } from './references.mjs';
import {
  buildCapabilityDimensionReport,
  loadCapabilityDimensions,
} from './capability-scoring.mjs';
import {
  applyCoreScoring,
  loadCoreScoringPolicy,
  CORE_TASK_THRESHOLD,
} from './core-scoring.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function findRunRoots(root) {
  const roots = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === 'pipeline-state.json') roots.add(directory);
      else if (entry.isFile() && entry.name === 'eval-summary-results.json' && directory.endsWith('/reports')) roots.add(dirname(directory));
    }
  };
  visit(root);
  return roots;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percent(value) {
  return value === null ? null : value * 100;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function diagnostic(diagnostics, severity, code, message, context = {}) {
  diagnostics.push({ severity, code, message, ...context });
}

function normalizeRunIdentity(result, state, runRoot) {
  const identity = result?.runIdentity || state?.runIdentity || {};
  return {
    harness: String(identity.harness || result?.harness || '').trim(),
    model: String(identity.model || result?.model || '').trim(),
    run_id: String(identity.runId || identity.run_id || result?.runId || result?.run_id || '').trim(),
    question_no: Number(result?.number || state?.question?.number || state?.question_no || identity.question || 0),
    question_id: String(result?.id || state?.question?.id || state?.question_id || '').trim(),
    run_root: runRoot,
  };
}

function runKey(identity) {
  return [identity.harness, identity.model, identity.question_id, identity.run_id].join('\u0001');
}

function scorePointwiseTask(requirement, item, diagnostics, identity) {
  const taskId = String(requirement.taskId);
  const criteria = requirement.criteria;
  if (item && Object.hasOwn(item, 'subResults')) {
    diagnostic(
      diagnostics,
      'error',
      'unsupported_legacy_criterion_results',
      `Pointwise task ${taskId} uses unsupported legacy field subResults.`,
      { ...identity, task_id: taskId },
    );
  }
  const criterionResults = Array.isArray(item?.criterionResults) ? item.criterionResults : [];
  const expectedIds = new Set(requirement.criterionIds);
  const criterionResultsById = new Map();
  const duplicateIds = new Set();
  for (const child of criterionResults) {
    const childId = String(child?.criterionId || '');
    if (criterionResultsById.has(childId)) duplicateIds.add(childId);
    criterionResultsById.set(childId, child);
    if (!expectedIds.has(childId)) {
      diagnostic(
        diagnostics,
        'error',
        'unknown_pointwise_criterion_id',
        `Pointwise task ${taskId} contains an unknown criterion id: ${childId || '(empty)'}.`,
        { ...identity, task_id: taskId, criterion_id: childId },
      );
    }
    if (Object.hasOwn(child || {}, 'taskId') || Object.hasOwn(child || {}, 'task')) {
      diagnostic(
        diagnostics,
        'error',
        'unsupported_legacy_criterion_fields',
        `Pointwise criterion ${childId || '(empty)'} uses unsupported legacy fields taskId/task.`,
        { ...identity, task_id: taskId, criterion_id: childId },
      );
    }
  }
  for (const childId of duplicateIds) {
    diagnostic(
      diagnostics,
      'error',
      'duplicate_pointwise_criterion_id',
      `Pointwise task ${taskId} contains duplicate criterion id ${childId || '(empty)'}.`,
      { ...identity, task_id: taskId, criterion_id: childId },
    );
  }
  const children = criteria.map((criterion, index) => {
    const expectedId = requirement.criterionIds[index];
    const child = duplicateIds.has(expectedId) ? null : criterionResultsById.get(expectedId) || null;
    const status = child ? String(child.status || '').trim() : 'missing';
    const valid = status === 'pass' || status === 'fail';
    return {
      criterion_id: expectedId,
      criterion,
      status,
      effective_only: valid ? (status === 'pass' ? 1 : 0) : null,
      zero_fill: status === 'pass' ? 1 : 0,
    };
  });
  if (criterionResults.length !== criteria.length) {
    diagnostic(
      diagnostics,
      'error',
      'pointwise_criterion_count_mismatch',
      `Pointwise task ${taskId} criterion count mismatch: expected=${criteria.length}, actual=${criterionResults.length}.`,
      { ...identity, task_id: taskId },
    );
  }
  if (item && (item.gsb !== undefined || item.pairwiseVerdict !== undefined)) {
    diagnostic(
      diagnostics,
      'error',
      'pointwise_contains_gsb',
      `Pointwise task ${taskId} carries pairwise scoring fields.`,
      { ...identity, task_id: taskId },
    );
  }
  const validChildren = children.filter((child) => child.effective_only !== null);
  return {
    task_id: taskId,
    judge_mode: requirement.judgeMode,
    status: String(item?.status || ''),
    gsb: null,
    item_count: children.length,
    valid_item_count: validChildren.length,
    exception_count: children.length - validChildren.length,
    effective_only: mean(validChildren.map((child) => child.effective_only)),
    zero_fill: mean(children.map((child) => child.zero_fill)) ?? 0,
    children,
  };
}

function scorePairwiseTask(requirement, item, diagnostics, identity) {
  const taskId = String(requirement.taskId);
  const status = String(item?.status || '').trim().toLowerCase();
  const gsb = normalizeGsb(item?.gsb);
  let valid = false;
  if (status === 'completed' && gsb) {
    valid = true;
  } else if (['blocked', 'needs_review'].includes(status) && item?.gsb === null) {
    valid = false;
  } else {
    diagnostic(
      diagnostics,
      'error',
      'invalid_pairwise_contract',
      `Pairwise task ${taskId} must use completed + one G/S/B, or blocked/needs_review + gsb=null.`,
      { ...identity, task_id: taskId, status, gsb: item?.gsb ?? null },
    );
  }
  if (item?.pairwiseVerdict !== undefined) {
    diagnostic(
      diagnostics,
      'error',
      'legacy_pairwise_verdict',
      `Pairwise task ${taskId} still uses pairwiseVerdict.`,
      { ...identity, task_id: taskId },
    );
  }
  if (item && Object.hasOwn(item, 'subResults')) {
    diagnostic(
      diagnostics,
      'error',
      'unsupported_legacy_criterion_results',
      `Pairwise task ${taskId} uses unsupported legacy field subResults.`,
      { ...identity, task_id: taskId },
    );
  }
  const children = Array.isArray(item?.criterionResults) ? item.criterionResults : [];
  const expectedChildIds = new Set(requirement.criterionIds);
  const seenChildIds = new Set();
  for (const child of children) {
    const childId = String(child?.criterionId || '');
    if (seenChildIds.has(childId)) {
      diagnostic(
        diagnostics,
        'error',
        'duplicate_pairwise_child_id',
        `Pairwise task ${taskId} contains duplicate child id ${childId || '(empty)'}.`,
        { ...identity, task_id: taskId, criterion_id: childId },
      );
    }
    seenChildIds.add(childId);
    if (!expectedChildIds.has(childId)) {
      diagnostic(
        diagnostics,
        'error',
        'unknown_pairwise_child_id',
        `Pairwise task ${taskId} contains an unknown child id: ${childId || '(empty)'}.`,
        { ...identity, task_id: taskId, criterion_id: childId },
      );
    }
    if (Object.hasOwn(child || {}, 'taskId') || Object.hasOwn(child || {}, 'task')) {
      diagnostic(
        diagnostics,
        'error',
        'unsupported_legacy_criterion_fields',
        `Pairwise criterion ${childId || '(empty)'} uses unsupported legacy fields taskId/task.`,
        { ...identity, task_id: taskId, criterion_id: childId },
      );
    }
    if (child && ['status', 'gsb', 'pairwiseVerdict', 'task_score'].some((field) => child[field] !== undefined && child[field] !== null)) {
      diagnostic(
        diagnostics,
        'error',
        'pairwise_child_scored',
        `Pairwise task ${taskId} has a child carrying a scoring field.`,
        { ...identity, task_id: taskId, criterion_id: String(child.criterionId || '') },
      );
    }
  }
  if (children.length !== expectedChildIds.size) {
    diagnostic(
      diagnostics,
      'error',
      'pairwise_child_count_mismatch',
      `Pairwise task ${taskId} child count mismatch: expected=${expectedChildIds.size}, actual=${children.length}.`,
      { ...identity, task_id: taskId },
    );
  }
  const score = valid ? GSB_SCORES[gsb] : null;
  return {
    task_id: taskId,
    judge_mode: requirement.judgeMode,
    status,
    gsb: valid ? gsb : null,
    item_count: 1,
    valid_item_count: valid ? 1 : 0,
    exception_count: valid ? 0 : 1,
    effective_only: score,
    zero_fill: score ?? 0,
    children: [],
  };
}

function scoreRunRecord(record, repository, diagnostics) {
  const { identity, result, strict, resultPath, statePath, strictPath } = record;
  const startDiagnosticCount = diagnostics.length;
  const identityMissing = [];
  for (const field of ['harness', 'model', 'run_id', 'question_id']) {
    if (!identity[field]) identityMissing.push(field);
  }
  if (!identity.question_no) identityMissing.push('question_no');
  if (identityMissing.length) {
    diagnostic(
      diagnostics,
      'error',
      'missing_run_identity',
      `Run identity is missing: ${identityMissing.join(', ')}.`,
      identity,
    );
  }
  const group = repository.groups.find((value) => value.id === identity.question_id);
  if (!group) {
    diagnostic(
      diagnostics,
      'error',
      'unknown_question',
      `Question id is not present in the prompt repository: ${identity.question_id || '(empty)'}.`,
      identity,
    );
    return {
      ...identity,
      strict_judge_status: String(strict?.status || ''),
      scorable: false,
      audit_passed: false,
      identity_valid: false,
      audit_exclusion_reasons: [
        ...identityMissing.map((field) => `missing_${field}`),
        'unknown_question',
      ],
      result_path: resultPath,
      state_path: statePath,
      strict_path: strictPath,
      tasks: [],
      effective_only: null,
      zero_fill: null,
      diagnostics: diagnostics.slice(startDiagnosticCount),
    };
  }
  if (Number(group.number) !== Number(identity.question_no)) {
    diagnostic(
      diagnostics,
      'error',
      'question_number_mismatch',
      `Question number mismatch for ${group.id}: dataset=${group.number}, result=${identity.question_no}.`,
      identity,
    );
  }
  if (!Array.isArray(result?.requirementResults)) {
    diagnostic(
      diagnostics,
      'error',
      'invalid_requirement_results',
      'Evaluator result has no requirementResults array.',
      identity,
    );
  }
  const requirementResults = Array.isArray(result?.requirementResults) ? result.requirementResults : [];
  const byTaskId = new Map();
  const duplicateTaskIds = new Set();
  for (const item of requirementResults) {
    const taskId = String(item?.taskId || '');
    if (byTaskId.has(taskId)) {
      duplicateTaskIds.add(taskId);
      diagnostic(
        diagnostics,
        'error',
        'duplicate_task_id',
        `Duplicate task_id in evaluator result: ${taskId}.`,
        { ...identity, task_id: taskId },
      );
    }
    byTaskId.set(taskId, item);
  }
  const authoritativeTaskIds = new Set(group.requirements.map((requirement) => String(requirement.taskId)));
  for (const taskId of byTaskId.keys()) {
    if (!authoritativeTaskIds.has(taskId)) {
      diagnostic(
        diagnostics,
        'error',
        'unknown_task_id',
        `Evaluator result contains an unknown task_id: ${taskId}.`,
        { ...identity, task_id: taskId },
      );
    }
  }
  const tasks = group.requirements.map((requirement) => {
    const taskId = String(requirement.taskId);
    const item = duplicateTaskIds.has(taskId) ? null : byTaskId.get(taskId);
    if (!item) {
      diagnostic(
        diagnostics,
        'error',
        'missing_task_result',
        `Evaluator result is missing task_id ${taskId}.`,
        { ...identity, task_id: taskId },
      );
    } else if (String(item.judgeMode || '') !== requirement.judgeMode) {
      diagnostic(
        diagnostics,
        'error',
        'judge_mode_mismatch',
        `judge_mode mismatch for task ${taskId}: expected=${requirement.judgeMode}, actual=${item.judgeMode || '(empty)'}.`,
        { ...identity, task_id: taskId },
      );
    }
    return requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB
      ? scorePairwiseTask(requirement, item, diagnostics, identity)
      : scorePointwiseTask(requirement, item, diagnostics, identity);
  });
  const validTasks = tasks.filter((task) => task.effective_only !== null);
  const runDiagnostics = diagnostics.slice(startDiagnosticCount);
  const hasStructuralError = runDiagnostics.some((item) => item.severity === 'error');
  const strictStatus = String(strict?.status || '').trim();
  if (!strictStatus) {
    diagnostic(
      diagnostics,
      'warning',
      'missing_strict_judge_status',
      'Strict Judge status is missing; its scheduled slot contributes zero to audited metrics.',
      identity,
    );
  } else if (strictStatus !== 'pass') {
    diagnostic(
      diagnostics,
      'warning',
      'strict_judge_not_passed',
      `Strict Judge status is ${strictStatus}; affected judgments will be zero-filled without discarding accepted judgments.`,
      identity,
    );
  }
  if (!['passed', 'failed'].includes(result?.buildAndRuntime?.status)) {
    diagnostic(diagnostics, 'warning', 'unverified_build_and_runtime', 'Missing or unverified buildAndRuntime contract; ASR cannot be successful.', identity);
  }
  const auditExclusionReasons = [];
  if (identityMissing.length) auditExclusionReasons.push('missing_run_identity');
  if (strictStatus !== 'pass') auditExclusionReasons.push(strictStatus ? 'strict_judge_not_passed' : 'missing_strict_judge_status');
  if (hasStructuralError) auditExclusionReasons.push('structural_validation_error');
  return {
    ...identity,
    row: group.row,
    strict_judge_status: strictStatus || null,
    strict_judge_issues: strict?.issues ?? null,
    pipeline_status: record.state?.finalStatus || record.state?.stage || null,
    build_and_runtime_status: ['passed', 'failed', 'unverified'].includes(result?.buildAndRuntime?.status) ? result.buildAndRuntime.status : 'unverified',
    build_and_runtime_passed: result?.buildAndRuntime?.status === 'passed'
      && typeof result.buildAndRuntime.reason === 'string' && Boolean(result.buildAndRuntime.reason.trim())
      && Array.isArray(result.buildAndRuntime.evidence) && result.buildAndRuntime.evidence.length > 0
      && result.buildAndRuntime.evidence.every((item) => typeof item === 'string' && item.trim()),
    reference: result?.reference || record.state?.reference || null,
    scorable: identityMissing.length === 0,
    audit_passed: identityMissing.length === 0 && strictStatus === 'pass' && !hasStructuralError,
    identity_valid: identityMissing.length === 0,
    audit_exclusion_reasons: auditExclusionReasons,
    result_path: resultPath,
    state_path: statePath,
    strict_path: strictPath,
    task_count: tasks.length,
    valid_task_count: validTasks.length,
    exception_task_count: tasks.length - validTasks.length,
    effective_only: mean(validTasks.map((task) => task.effective_only)),
    zero_fill: mean(tasks.map((task) => task.zero_fill)) ?? 0,
    tasks,
    diagnostics: diagnostics.slice(startDiagnosticCount),
  };
}

function loadRunRecords(runsRoot, diagnostics) {
  const records = [];
  const roots = findRunRoots(runsRoot);
  const scheduled = new Map();
  const batchPath = join(dirname(runsRoot), 'batch-state.json');
  if (existsSync(batchPath)) {
    try {
      const batch = readJson(batchPath);
      if (resolve(batch.runs_root || '') === runsRoot) {
        for (const entry of batch.entries || []) {
          const root = resolve(entry.output_root);
          const local = relative(runsRoot, root);
          if (local === '..' || local.startsWith('../')) throw new Error('Scheduled output must stay inside runs_root.');
          roots.add(root);
          scheduled.set(root, {
            runIdentity: { harness: batch.harness, model: batch.model, run_id: entry.run_id },
            question: { id: entry.question_id, number: entry.question_no },
            finalStatus: entry.status,
          });
        }
      }
    } catch (error) {
      throw new Error(`Invalid scheduled batch state ${batchPath}: ${error.message}`);
    }
  }
  for (const runRoot of [...roots].sort()) {
    const resultPath = join(runRoot, 'reports/eval-summary-results.json');
    const statePath = join(runRoot, 'pipeline-state.json');
    const strictPath = join(runRoot, 'reports/eval-judge-results-strict.json');
    let results = null;
    let state = scheduled.get(runRoot) || null;
    let strict = null;
    if (existsSync(resultPath)) {
      try { results = readJson(resultPath); }
      catch (error) { diagnostic(diagnostics, 'error', 'invalid_result_json', error.message, { result_path: resultPath }); }
    } else diagnostic(diagnostics, 'warning', 'missing_result_json', 'Scheduled result is missing and will be scored as zero.', { run_root: runRoot });
    if (existsSync(statePath)) {
      try {
        const loaded = readJson(statePath);
        state = { ...state, ...loaded, runIdentity: { ...state?.runIdentity, ...loaded?.runIdentity }, question: { ...state?.question, ...loaded?.question } };
      } catch (error) { diagnostic(diagnostics, 'warning', 'invalid_pipeline_state', error.message, { state_path: statePath }); }
    }
    if (existsSync(strictPath)) {
      try { strict = readJson(strictPath); }
      catch (error) { diagnostic(diagnostics, 'warning', 'invalid_strict_json', error.message, { strict_path: strictPath }); }
    }
    for (const result of Array.isArray(results) && results.length ? results : [results]) {
      records.push({
        identity: normalizeRunIdentity(result, state, runRoot), result, state, strict,
        resultPath: existsSync(resultPath) ? resultPath : null,
        statePath: existsSync(statePath) ? statePath : null,
        strictPath: existsSync(strictPath) ? strictPath : null,
      });
    }
  }
  return records;
}

function applyAuditedTaskScores(run, group) {
  const requirements = new Map(group?.requirements.map((requirement) => [String(requirement.taskId), requirement]));
  const excludedTasks = new Set();
  const excludedCriteria = new Map([...requirements.keys()].map((taskId) => [taskId, new Set()]));
  let scorable = run.scorable && run.identity_valid;
  for (const issue of run.diagnostics) {
    if (issue.severity !== 'error') continue;
    if (!issue.task_id || !requirements.has(issue.task_id)) scorable = false;
    else if (requirements.get(issue.task_id).judgeMode === JUDGE_MODE_PAIRWISE_GSB) excludedTasks.add(issue.task_id);
    else if (issue.criterion_id) excludedCriteria.get(issue.task_id).add(issue.criterion_id);
    else if (issue.code !== 'pointwise_criterion_count_mismatch') excludedTasks.add(issue.task_id);
  }
  const auditIssues = Array.isArray(run.strict_judge_issues) ? run.strict_judge_issues : [];
  const blockingIssues = auditIssues.filter((issue) => ['high', 'medium'].includes(issue?.severity));
  if (!['pass', 'invalid', 'needs-followup'].includes(run.strict_judge_status)
    || (run.strict_judge_status !== 'pass' && !blockingIssues.length)
    || auditIssues.some((issue) => !['high', 'medium', 'low'].includes(issue?.severity))) scorable = false;
  for (const issue of blockingIssues) {
    if (issue.id && issue.id !== group?.id) continue;
    if (issue.scope === 'runtime') {
      run.build_and_runtime_passed = false;
      continue;
    }
    const target = String(issue.taskId || '');
    if (requirements.has(target)) {
      excludedTasks.add(target);
      continue;
    }
    const affected = (group?.requirements || []).filter((requirement) => requirement.criterionIds.includes(target));
    if (!affected.length) scorable = false;
    for (const requirement of affected) {
      const taskId = String(requirement.taskId);
      if (requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB) excludedTasks.add(taskId);
      else excludedCriteria.get(taskId).add(target);
    }
  }
  run.tasks = run.tasks.map((task) => {
    const accepted = scorable && !excludedTasks.has(task.task_id);
    const children = task.children.map((child) => {
      const valid = accepted && !excludedCriteria.get(task.task_id).has(child.criterion_id) && child.effective_only !== null;
      return { ...child, score: valid ? child.zero_fill : 0, audited_valid: valid };
    });
    const pairwise = task.judge_mode === JUDGE_MODE_PAIRWISE_GSB;
    return {
      ...task,
      children,
      score: pairwise ? (accepted ? task.zero_fill : 0)
        : children.reduce((sum, child) => sum + child.score, 0) / task.item_count,
      audited_valid_item_count: pairwise ? (accepted ? task.valid_item_count : 0)
        : children.filter((child) => child.audited_valid).length,
    };
  });
  if (!scorable) run.build_and_runtime_passed = false;
  run.scoring_status = !scorable ? 'unscorable'
    : run.tasks.some((task) => task.audited_valid_item_count < task.item_count) ? 'partial' : 'ready';
  run.ors = scorable ? mean(run.tasks.map((task) => task.score)) ?? 0 : 0;
  run.ats = run.ors;
}

function markDuplicateRuns(runDetails, diagnostics) {
  const grouped = new Map();
  for (const run of runDetails) {
    const key = runKey(run);
    const items = grouped.get(key) || [];
    items.push(run);
    grouped.set(key, items);
  }
  for (const items of grouped.values()) {
    if (items.length < 2) continue;
    for (const run of items) {
      run.audit_passed = false;
      run.identity_valid = false;
      run.audit_exclusion_reasons = [
        ...new Set([...(run.audit_exclusion_reasons || []), 'duplicate_run_identity']),
      ];
    }
    diagnostic(
      diagnostics,
      'error',
      'duplicate_run_identity',
      `Duplicate run identity detected ${items.length} times.`,
      {
        harness: items[0].harness,
        model: items[0].model,
        question_id: items[0].question_id,
        run_id: items[0].run_id,
        run_roots: items.map((item) => item.run_root),
      },
    );
  }
}

function buildScheduledCohorts(repository, runDetails, expectedRuns) {
  const conditions = new Map();
  for (const run of runDetails) {
    if (!run.harness || !run.model) continue;
    const key = JSON.stringify([run.harness, run.model]);
    if (!conditions.has(key)) conditions.set(key, { harness: run.harness, model: run.model, runs: [] });
    conditions.get(key).runs.push(run);
  }
  return [...conditions.values()]
    .sort((left, right) => left.harness.localeCompare(right.harness) || left.model.localeCompare(right.model))
    .map(({ harness, model, runs }) => ({
      harness, model,
      questions: repository.groups.map((group) => {
        const slots = new Map();
        for (const run of runs.filter((record) => record.question_id === group.id && record.run_id)) {
          const records = slots.get(run.run_id) || [];
          records.push(run);
          slots.set(run.run_id, records);
        }
        if (slots.size > expectedRuns) {
          throw new Error(`Found ${slots.size} run slots for ${harness}/${model}/${group.id}, exceeding --expected-runs=${expectedRuns}. Use a single scheduled cohort; do not select runs by score.`);
        }
        return {
          group,
          runs: [...slots.values()].map((records) => records.length === 1 ? records[0] : null),
          observed_run_count: slots.size,
        };
      }),
    }));
}

function buildLeaderboard(cohorts, expectedRuns, corePolicy) {
  const board = new Map();
  for (const cohort of cohorts) {
    const questionScores = cohort.questions.map(({ group, runs, observed_run_count: observedRuns }) => {
      const coreAvailable = corePolicy.status === 'ready'
        && corePolicy.questionsById.get(group.id)?.tasks.some((task) => task.is_core_task);
      const average = (metric) => runs.reduce((sum, run) => sum + (run?.[metric] ?? 0), 0) / expectedRuns;
      const ats = average('ats');
      const ctpr = coreAvailable ? average('ctpr') : null;
      const asr = coreAvailable ? average('asr') : null;
      return {
        question_no: group.number, question_id: group.id,
        ats, ats_percent: percent(ats), ctpr, ctpr_percent: percent(ctpr), asr, asr_percent: percent(asr),
        ors: ats, ors_percent: percent(ats), tsr: asr, tsr_percent: percent(asr),
        run_count: observedRuns,
        valid_run_count: runs.filter((run) => run && run.scoring_status !== 'unscorable').length,
        expected_run_count: expectedRuns, missing_run_count: expectedRuns - observedRuns,
        run_coverage: ratio(observedRuns, expectedRuns),
      };
    });
    const average = (metric) => questionScores.some((question) => question[metric] === null)
      ? null : mean(questionScores.map((question) => question[metric]));
    const ats = average('ats');
    const ctpr = average('ctpr');
    const asr = average('asr');
    const observedQuestions = questionScores.filter((question) => question.run_count > 0).length;
    const validQuestions = questionScores.filter((question) => question.valid_run_count > 0).length;
    const runCount = questionScores.reduce((sum, question) => sum + question.run_count, 0);
    const expectedRunCount = questionScores.length * expectedRuns;
    if (!board.has(cohort.harness)) board.set(cohort.harness, []);
    board.get(cohort.harness).push({
      rank: null, harness: cohort.harness, model: cohort.model, primary_metric: 'asr', threshold: CORE_TASK_THRESHOLD,
      ats, ats_percent: percent(ats), ctpr, ctpr_percent: percent(ctpr), asr, asr_percent: percent(asr),
      ors: ats, ors_percent: percent(ats), tsr: asr, tsr_percent: percent(asr),
      question_scores: questionScores, dimension_scores: null,
      coverage: {
        questions: { observed: observedQuestions, valid: validQuestions, total: questionScores.length, ratio: ratio(observedQuestions, questionScores.length), valid_ratio: ratio(validQuestions, questionScores.length) },
        runs: { actual: runCount, expected: expectedRunCount, ratio: ratio(runCount, expectedRunCount) },
      },
      run_count: runCount, expected_run_count: expectedRunCount,
    });
  }
  for (const entries of board.values()) {
    entries.sort((left, right) => (right.asr ?? -1) - (left.asr ?? -1) || left.model.localeCompare(right.model));
    let previous = null;
    for (const [index, entry] of entries.entries()) {
      entry.rank = entry.asr === null ? null
        : previous && Math.abs(previous.asr - entry.asr) <= 1e-12 ? previous.rank : index + 1;
      previous = entry;
    }
  }
  return Object.fromEntries(board);
}

function markdownScore(value) {
  return value === null || value === undefined ? '不可用' : (value * 100).toFixed(2);
}

function markdownCell(value) {
  return String(value ?? '').replaceAll('|', '&#124;').replaceAll('\n', ' ');
}

function writeMarkdown(result, path) {
  const lines = [
    '# JoyFrontBench 最终评分报告', '',
    '## 指标与统计口径', '',
    '- 题库：`' + result.source.prompts_root + '`；Run 根目录：`' + result.source.runs_root + '`。',
    `- Reference：${result.reference_set.kind}；custom reference 只进入实验榜。不同 harness 独立排名。`,
    `- 每题计划运行 ${result.scoring_policy.expected_runs_per_question} 次；发现 ${result.source.discovered_run_count} 条记录。`,
    '- 面向目标的验收契约：至少含一条必达判据的 pointwise Task 为核心 Task；全部必达判据通过且 Task 完成比例达到 80% 才算通过。',
    '- ATS（Average Task Score）：每道题内所有 Task 等权，pointwise 按全部 criteria 的通过比例计分，pairwise G/S/B 分别为 1/0.5/0。',
    '- CTPR（Core-Task Pass Rate）：通过验收的核心 Task 所占比例。',
    '- ASR（Application Success Rate，主指标）：构建与运行通过，且同一次运行的同一份应用通过所有核心 Task。',
    '- ATS、CTPR、ASR 均先在每题的计划运行内平均，再对题目等权宏平均；缺失、重复身份和整条无效记录保留在分母并按零计。',
    '- 局部判定或证据无效只将受影响项置零；构建/运行失败仅额外将 ASR 置零，独立有效的源码判定仍可贡献 ATS、CTPR 和能力分数。',
    '- 能力分数（Capability Scores）：每个 Task 先按计划运行数平均，再对同一维度的 Task 等权平均，八维分别报告。',
    '- 所有表格使用百分制；先计算与排名，最后显示两位小数。', '',
  ];
  for (const [scope, title] of [['official', '正式榜'], ['experimental', '实验榜（Custom Reference）']]) {
    const board = result.leaderboards[scope];
    if (scope === 'experimental' && !Object.keys(board).length) continue;
    lines.push(`## ${title}`, '');
    if (!Object.keys(board).length) lines.push('无可用结果。', '');
    for (const [harness, models] of Object.entries(board)) {
      lines.push(`### ${harness}`, '', '| 排名 | 模型 | ATS (%) | CTPR (%) | ASR (%) | 题目覆盖 | Run 覆盖 |', '| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
      for (const model of models) {
        lines.push(`| ${model.rank ?? '-'} | ${markdownCell(model.model)} | ${markdownScore(model.ats)} | ${markdownScore(model.ctpr)} | ${markdownScore(model.asr)} | ${model.coverage.questions.observed}/${model.coverage.questions.total} | ${model.run_count}/${model.expected_run_count} |`);
      }
      lines.push('');
    }
  }
  if (result.core_scoring.status !== 'ready') lines.push('核心策略不可用：仅报告 ATS 与可用的能力分数，不生成 CTPR、ASR 或主指标排名。', '');
  lines.push('## 各模型各题指标', '');
  for (const board of Object.values(result.leaderboards)) {
    for (const [harness, models] of Object.entries(board)) {
      for (const model of models) {
        lines.push(`### ${harness} / ${markdownCell(model.model)}`, '', '| 题号 | ID | ATS (%) | CTPR (%) | ASR (%) | Run |', '| ---: | --- | ---: | ---: | ---: | ---: |');
        for (const question of model.question_scores) {
          lines.push(`| ${question.question_no} | ${question.question_id} | ${markdownScore(question.ats)} | ${markdownScore(question.ctpr)} | ${markdownScore(question.asr)} | ${question.run_count}/${question.expected_run_count} |`);
        }
        lines.push('');
      }
    }
  }
  lines.push('## 八维能力分数（Capability Scores）', '');
  if (result.capability_dimensions.status !== 'ready') lines.push('能力维度标签不可用，未生成能力分数。', '');
  else {
    lines.push(`- 统计范围：${result.capability_dimensions.scope}；有效 Task-run 指至少有一个通过审计的 pass/fail 或 G/S/B 判定。`, '');
    if (result.capability_dimensions.scope === 'experimental') lines.push('- 自定义参考素材下的能力分数仅供实验比较，不是正式指标。', '');
    for (const [harness, models] of Object.entries(result.capability_dimensions.dimension_scores)) {
      for (const model of models) {
        lines.push(`### ${harness} / ${markdownCell(model.model)}`, '', '| 维度 | 能力分数 (%) | 有效 / 全部 Task | 题目数 | 有效 / 已发现 / 计划 Task-run |', '| --- | ---: | ---: | ---: | ---: |');
        for (const dimension of model.dimension_scores) {
          lines.push(`| ${dimension.name_en} (${dimension.abbreviation}) / ${dimension.dimension} | ${markdownScore(dimension.score)} | ${dimension.valid_task_count}/${dimension.total_task_count} | ${dimension.question_count} | ${dimension.valid_task_run_count}/${dimension.observed_task_run_count}/${dimension.expected_task_run_count} |`);
        }
        lines.push('');
      }
    }
  }
  lines.push('## 每次 Run 明细', '', '| Harness | 模型 | 题目 | Run ID | 审计状态 | 计分状态 | 构建运行 | ATS (%) | CTPR (%) | ASR (%) |', '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const run of result.run_details) {
    const runtime = run.build_and_runtime_passed ? 'passed' : run.build_and_runtime_status === 'failed' ? 'failed' : 'unverified';
    lines.push(`| ${markdownCell(run.harness)} | ${markdownCell(run.model)} | ${run.question_id || '-'} | ${markdownCell(run.run_id)} | ${run.strict_judge_status || 'missing'} | ${run.scoring_status} | ${runtime} | ${markdownScore(run.ats)} | ${markdownScore(run.ctpr)} | ${markdownScore(run.asr)} |`);
  }
  lines.push('', '## 异常与诊断', '');
  if (!result.diagnostics.length) lines.push('无。', '');
  else {
    lines.push('| 级别 | Code | Harness/模型/题目/Run | 说明 |', '| --- | --- | --- | --- |');
    for (const item of result.diagnostics) {
      lines.push(`| ${item.severity} | ${item.code} | ${markdownCell(`${item.harness || '-'}/${item.model || '-'}/${item.question_id || '-'}/${item.run_id || '-'}`)} | ${markdownCell(item.message)} |`);
    }
    lines.push('');
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
}

export function scorePipelineRuns(options) {
  const promptsRoot = assertDirectory(options.promptsRoot, '--prompts');
  const runsRoot = assertDirectory(options.runsRoot, '--runs-root');
  if (!options.outputRoot) throw new Error('Missing --output-root.');
  const outputRoot = resolve(options.outputRoot);
  mkdirSync(outputRoot, { recursive: true });
  const expectedRuns = Number(options.expectedRuns ?? 3);
  if (!Number.isInteger(expectedRuns) || expectedRuns < 1) throw new Error('expectedRuns must be a positive integer.');
  const repository = parsePromptGroups(promptsRoot);
  const diagnostics = [];
  const corePolicy = loadCoreScoringPolicy({
    promptsRoot,
    configuredPath: options.corePolicyPath,
    repository,
    diagnostics,
  });
  const capabilityLabels = loadCapabilityDimensions({ promptsRoot, repository, diagnostics });
  const records = loadRunRecords(runsRoot, diagnostics);
  if (!records.length) {
    diagnostic(
      diagnostics,
      'warning',
      'no_pipeline_results',
      `No reports/eval-summary-results.json files were found under ${runsRoot}.`,
    );
  }
  const runDetails = records.map((record) => scoreRunRecord(record, repository, diagnostics));
  const referenceSet = summarizeReferenceCohort(runDetails);
  if (referenceSet.kind === 'custom') diagnostic(diagnostics, 'warning', 'custom_reference_set', 'Custom references are reported only in experimental leaderboards.');
  markDuplicateRuns(runDetails, diagnostics);
  for (const run of runDetails) applyAuditedTaskScores(run, repository.groups.find((group) => group.id === run.question_id));
  applyCoreScoring(runDetails, corePolicy);
  const cohorts = buildScheduledCohorts(repository, runDetails, expectedRuns);
  const capabilityDimensions = buildCapabilityDimensionReport({ runDetails, cohorts, labels: capabilityLabels, expectedRuns, referenceSet });
  const board = buildLeaderboard(cohorts, expectedRuns, corePolicy);
  const leaderboards = { official: referenceSet.kind === 'custom' ? {} : board, experimental: referenceSet.kind === 'custom' ? board : {} };
  for (const [harness, models] of Object.entries(board)) {
    for (const model of models) {
      model.dimension_scores = capabilityDimensions.dimension_scores?.[harness]?.find((entry) => entry.model === model.model)?.dimension_scores ?? null;
      model.dimension_score_metric = 'capability_scores';
      model.dimension_score_scope = capabilityDimensions.scope;
    }
  }
  const applicationSuccessRule = 'audited build-and-runtime contract passed and all core tasks pass on the same artifact in one run';
  const capabilityScoreRule = { runs_within_task: 'scheduled_mean', tasks_within_dimension: 'equal', empty_dimension_score: null, uses_core_gates: false };
  const result = {
    generated_at: new Date().toISOString(),
    reference_set: referenceSet,
    scoring_policy: {
      benchmark: 'JoyFrontBench',
      primary_metric: 'asr',
      metrics: { ats: 'Average Task Score', ctpr: 'Core-Task Pass Rate', asr: 'Application Success Rate', capability_scores: 'Capability Scores' },
      legacy_metric_aliases: { ors: 'ats', tsr: 'asr', d_ors: 'capability_scores' },
      gsb: GSB_SCORES,
      expected_runs_per_question: expectedRuns,
      completion_threshold: CORE_TASK_THRESHOLD,
      core_task_threshold: CORE_TASK_THRESHOLD,
      task_score_policy: 'audited_zero_fill',
      localized_audit_failure: 'zero_affected_items',
      missing_run_score: 0,
      unscorable_run_score: 0,
      duplicate_run_identity: 'one_zero_filled_slot',
      excess_run_slots: 'reject',
      weighting: { criteria_within_task: 'equal', tasks_within_question: 'equal', runs_within_model_question: 'scheduled_mean', questions_within_model: 'equal' },
      core_task_rule: 'pointwise task containing at least one mandatory criterion (stored level: gating)',
      core_task_pass_rule: 'all mandatory criteria pass and audited task completion >= 0.8',
      asr_rule: applicationSuccessRule,
      tsr_rule: applicationSuccessRule,
      missing_runtime_contract: 'asr_zero',
      capability_scores: capabilityScoreRule,
      d_ors: capabilityScoreRule,
    },
    source: {
      prompts_root: promptsRoot,
      runs_root: runsRoot,
      core_policy: corePolicy.status === 'ready' ? corePolicy.path : null,
      capability_dimensions: capabilityLabels.status === 'ready' ? capabilityLabels.path : null,
      final_score_skill: join(projectRoot, 'skills/final-score/SKILL.md'),
      discovered_run_count: runDetails.length,
      expected_question_count: repository.groups.length,
    },
    core_scoring: {
      status: corePolicy.status,
      threshold: CORE_TASK_THRESHOLD,
      policy_path: corePolicy.path,
      policy_version: corePolicy.version ?? null,
      policy_kind: corePolicy.kind ?? null,
      review_required: corePolicy.review_required ?? null,
      summary: corePolicy.summary,
    },
    capability_dimensions: capabilityDimensions,
    leaderboards,
    run_details: runDetails,
    diagnostics,
  };
  const jsonPath = join(outputRoot, 'final-score.json');
  const markdownPath = join(outputRoot, 'final-score.md');
  const manifestPath = join(outputRoot, 'scoring-input-manifest.json');
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeMarkdown(result, markdownPath);
  writeFileSync(manifestPath, `${JSON.stringify({
    generated_at: result.generated_at,
    prompts_root: promptsRoot,
    runs_root: runsRoot,
    core_policy: corePolicy.status === 'ready' ? corePolicy.path : null,
    capability_dimensions: capabilityLabels.status === 'ready' ? capabilityLabels.path : null,
    result_files: records.filter((record) => record.resultPath).map((record) => relative(runsRoot, record.resultPath).replace(/\\/gu, '/')),
  }, null, 2)}\n`);
  return { result, jsonPath, markdownPath, manifestPath, outputRoot };
}
