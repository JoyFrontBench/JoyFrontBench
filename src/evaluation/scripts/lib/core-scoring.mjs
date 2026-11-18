import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JUDGE_MODE_PAIRWISE_GSB } from './tasks.mjs';

export const DEFAULT_CORE_POLICY_FILE = 'core-criteria-policy.json';
export const CORE_TASK_THRESHOLD = 0.8;

const CORE_LEVELS = new Set(['gating', 'should', 'quality']);

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function diagnostic(diagnostics, severity, code, message, context = {}) {
  diagnostics.push({ severity, code, message, ...context });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeText(value) {
  return String(value || '').replace(/\r/gu, '').trim();
}

function sameStringArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => String(value) === String(right[index]));
}

function derivedCoreLevel(levels) {
  if (levels.includes('gating')) return 'gating';
  if (levels.includes('should')) return 'should';
  return 'quality';
}

export function loadCoreScoringPolicy({
  promptsRoot,
  configuredPath,
  repository,
  diagnostics,
}) {
  const explicitPath = String(configuredPath || '').trim();
  const policyPath = explicitPath
    ? resolve(explicitPath)
    : join(promptsRoot, DEFAULT_CORE_POLICY_FILE);
  if (!existsSync(policyPath)) {
    if (explicitPath) {
      throw new Error(`--core-policy must be an existing file: ${policyPath}`);
    }
    diagnostic(
      diagnostics,
      'warning',
      'core_policy_not_found',
      `CTPR and ASR are unavailable because the core scoring policy was not found: ${policyPath}`,
      { core_policy_path: policyPath },
    );
    return {
      status: 'not_available',
      path: policyPath,
      questionsById: new Map(),
      summary: null,
    };
  }
  if (!statSync(policyPath).isFile()) {
    throw new Error(`Core scoring policy must be a file: ${policyPath}`);
  }

  let document;
  try {
    document = readJson(policyPath);
  } catch (error) {
    throw new Error(`Invalid core scoring policy JSON ${policyPath}: ${error.message}`);
  }
  if (!document || !Array.isArray(document.questions)) {
    throw new Error(`Core scoring policy has no questions array: ${policyPath}`);
  }
  if (String(document.kind || '') !== 'core-criteria-policy') {
    throw new Error(`Core scoring policy has an unsupported kind: ${document.kind || '(empty)'}`);
  }
  if (Number(document.version) !== 2) {
    throw new Error(`Core scoring policy has an unsupported version: ${document.version ?? '(empty)'}`);
  }
  if (document.review_required !== false) {
    throw new Error(`Core scoring policy is not approved for scoring: ${policyPath}`);
  }

  const groupsById = new Map(repository.groups.map((group) => [group.id, group]));
  const questionsById = new Map();
  const totals = {
    questions: 0,
    tasks: 0,
    core_tasks: 0,
    criteria: 0,
    gating: 0,
    should: 0,
    quality: 0,
  };
  for (const question of document.questions) {
    const questionId = String(question?.question_id || '').trim();
    if (!questionId || questionsById.has(questionId)) {
      throw new Error(`Core scoring policy contains a missing or duplicate question_id: ${questionId || '(empty)'}`);
    }
    const group = groupsById.get(questionId);
    if (!group) {
      throw new Error(`Core scoring policy contains an unknown question_id: ${questionId}`);
    }
    if (Number(question.question_no) !== Number(group.number)) {
      throw new Error(
        `Core scoring policy question number mismatch for ${questionId}: expected=${group.number}, actual=${question.question_no}`,
      );
    }
    if (!Array.isArray(question.tasks)) {
      throw new Error(`Core scoring policy question ${questionId} has no tasks array.`);
    }

    const policyTasksById = new Map();
    for (const task of question.tasks) {
      const taskId = String(task?.task_id || '').trim();
      if (!taskId || policyTasksById.has(taskId)) {
        throw new Error(`Core scoring policy ${questionId} contains a missing or duplicate task_id: ${taskId || '(empty)'}`);
      }
      policyTasksById.set(taskId, task);
    }
    if (policyTasksById.size !== group.requirements.length) {
      throw new Error(
        `Core scoring policy task count mismatch for ${questionId}: expected=${group.requirements.length}, actual=${policyTasksById.size}`,
      );
    }

    const normalizedTasks = [];
    for (const requirement of group.requirements) {
      const taskId = String(requirement.taskId);
      const policyTask = policyTasksById.get(taskId);
      if (!policyTask) {
        throw new Error(`Core scoring policy ${questionId} is missing task_id ${taskId}.`);
      }
      if (String(policyTask.judge_mode || '') !== requirement.judgeMode) {
        throw new Error(
          `Core scoring policy judge_mode mismatch for ${questionId}/${taskId}: expected=${requirement.judgeMode}, actual=${policyTask.judge_mode || '(empty)'}`,
        );
      }
      if (normalizeText(policyTask.task) !== normalizeText(requirement.task)) {
        throw new Error(`Core scoring policy task text mismatch for ${questionId}/${taskId}.`);
      }

      const expectedCriteria = requirement.criteria;
      const criteria = Array.isArray(policyTask.criteria) ? policyTask.criteria : [];
      if (criteria.length !== expectedCriteria.length) {
        throw new Error(
          `Core scoring policy criterion count mismatch for ${questionId}/${taskId}: expected=${expectedCriteria.length}, actual=${criteria.length}`,
        );
      }
      const normalizedCriteria = criteria.map((criterion, index) => {
        const criterionId = String(criterion?.criterion_id || '').trim();
        const expectedId = requirement.criterionIds[index];
        const level = String(criterion?.level || '').trim();
        if (criterionId !== expectedId) {
          throw new Error(
            `Core scoring policy criterion id mismatch for ${questionId}/${taskId}: expected=${expectedId}, actual=${criterionId || '(empty)'}`,
          );
        }
        if (normalizeText(criterion?.criterion) !== normalizeText(expectedCriteria[index])) {
          throw new Error(`Core scoring policy criterion text mismatch for ${questionId}/${criterionId}.`);
        }
        if (!CORE_LEVELS.has(level)) {
          throw new Error(`Core scoring policy has invalid level for ${questionId}/${criterionId}: ${level || '(empty)'}`);
        }
        if (requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB && level === 'gating') {
          throw new Error(`Pairwise criterion cannot be gating in core scoring policy: ${questionId}/${criterionId}`);
        }
        totals.criteria += 1;
        totals[level] += 1;
        return {
          criterion_id: criterionId,
          criterion: expectedCriteria[index],
          level,
        };
      });
      const levels = normalizedCriteria.map((criterion) => criterion.level);
      const isCoreTask = requirement.judgeMode !== JUDGE_MODE_PAIRWISE_GSB
        && levels.includes('gating');
      if (Boolean(policyTask.is_core_task) !== isCoreTask) {
        throw new Error(`Core scoring policy is_core_task mismatch for ${questionId}/${taskId}.`);
      }
      const derivedLevel = derivedCoreLevel(levels);
      if (String(policyTask.derived_level || '') !== derivedLevel) {
        throw new Error(
          `Core scoring policy derived_level mismatch for ${questionId}/${taskId}: expected=${derivedLevel}, actual=${policyTask.derived_level || '(empty)'}`,
        );
      }
      const expectedCoreGateScope = requirement.judgeMode === JUDGE_MODE_PAIRWISE_GSB
        ? 'task'
        : 'criteria';
      if (String(policyTask.core_gate_scope || '') !== expectedCoreGateScope) {
        throw new Error(
          `Core scoring policy core_gate_scope mismatch for ${questionId}/${taskId}: expected=${expectedCoreGateScope}, actual=${policyTask.core_gate_scope || '(empty)'}`,
        );
      }
      totals.tasks += 1;
      if (isCoreTask) totals.core_tasks += 1;
      normalizedTasks.push({
        task_id: taskId,
        judge_mode: requirement.judgeMode,
        derived_level: derivedLevel,
        is_core_task: isCoreTask,
        core_gate_scope: expectedCoreGateScope,
        criteria: normalizedCriteria,
      });
    }

    const derivedCoreTaskIds = normalizedTasks
      .filter((task) => task.is_core_task)
      .map((task) => task.task_id);
    const declaredCoreTaskIds = Array.isArray(question.core_task_ids)
      ? question.core_task_ids.map(String)
      : [];
    if (!sameStringArray(declaredCoreTaskIds, derivedCoreTaskIds)) {
      throw new Error(`Core scoring policy core_task_ids mismatch for ${questionId}.`);
    }
    totals.questions += 1;
    questionsById.set(questionId, {
      question_no: Number(group.number),
      question_id: questionId,
      core_task_ids: derivedCoreTaskIds,
      tasks: normalizedTasks,
    });
  }

  if (questionsById.size !== repository.groups.length) {
    const missing = repository.groups
      .map((group) => group.id)
      .filter((questionId) => !questionsById.has(questionId));
    throw new Error(`Core scoring policy is missing prompt questions: ${missing.join(', ')}`);
  }
  for (const [key, value] of Object.entries(totals)) {
    if (document.summary?.[key] !== undefined && Number(document.summary[key]) !== value) {
      throw new Error(
        `Core scoring policy summary mismatch for ${key}: expected=${value}, actual=${document.summary[key]}`,
      );
    }
  }

  return {
    status: 'ready',
    path: policyPath,
    version: Number(document.version),
    kind: String(document.kind || ''),
    review_required: Boolean(document.review_required),
    summary: totals,
    questionsById,
  };
}

export function applyCoreScoring(runDetails, corePolicy) {
  for (const run of runDetails) {
    const questionPolicy = corePolicy.status === 'ready'
      ? corePolicy.questionsById.get(run.question_id) : null;
    if (!questionPolicy) {
      run.core_policy_available = false;
      run.gating_item_count = null;
      run.passed_gating_item_count = null;
      run.gating_pass_rate = null;
      run.gating_all_passed = null;
      run.core_task_count = null;
      run.passed_core_task_count = null;
      run.failed_core_task_ids = [];
      run.ctpr = null;
      run.tsr = null;
      run.asr = null;
      continue;
    }

    const policyTasksById = new Map(questionPolicy.tasks.map((task) => [task.task_id, task]));
    let gatingItemCount = 0;
    let passedGatingItemCount = 0;
    let coreTaskCount = 0;
    let passedCoreTaskCount = 0;
    const failedCoreTaskIds = [];

    run.tasks = run.tasks.map((task) => {
      const policyTask = policyTasksById.get(String(task.task_id));
      if (!policyTask) return task;
      const criteriaById = new Map(policyTask.criteria.map((criterion) => [criterion.criterion_id, criterion]));
      const children = task.children.map((child) => ({
        ...child,
        importance_level: criteriaById.get(String(child.criterion_id))?.level || null,
      }));
      const gatingChildren = children.filter((child) => child.importance_level === 'gating');
      const passedGatingChildren = gatingChildren.filter((child) => child.score === 1);
      gatingItemCount += gatingChildren.length;
      passedGatingItemCount += passedGatingChildren.length;
      const allGatingPassed = gatingChildren.length
        ? passedGatingChildren.length === gatingChildren.length : null;
      const completion = task.score;
      const coreTaskPass = policyTask.is_core_task
        ? allGatingPassed === true && completion >= CORE_TASK_THRESHOLD : null;
      if (policyTask.is_core_task) {
        coreTaskCount += 1;
        if (coreTaskPass) passedCoreTaskCount += 1;
        else failedCoreTaskIds.push(task.task_id);
      }
      return {
        ...task,
        derived_level: policyTask.derived_level,
        is_core_task: policyTask.is_core_task,
        core_gate_scope: policyTask.core_gate_scope,
        gating_item_count: gatingChildren.length,
        passed_gating_item_count: passedGatingChildren.length,
        all_gating_passed: allGatingPassed,
        core_completion: completion,
        core_threshold: policyTask.is_core_task ? CORE_TASK_THRESHOLD : null,
        core_task_pass: coreTaskPass,
        children,
      };
    });

    run.core_policy_available = true;
    run.gating_item_count = gatingItemCount;
    run.passed_gating_item_count = passedGatingItemCount;
    run.gating_pass_rate = ratio(passedGatingItemCount, gatingItemCount);
    run.gating_all_passed = run.scoring_status !== 'unscorable'
      && gatingItemCount > 0 && passedGatingItemCount === gatingItemCount;
    run.core_task_count = coreTaskCount;
    run.passed_core_task_count = passedCoreTaskCount;
    run.failed_core_task_ids = failedCoreTaskIds;
    run.ctpr = coreTaskCount ? ratio(passedCoreTaskCount, coreTaskCount) : null;
    run.tsr = coreTaskCount ? Number(run.scoring_status !== 'unscorable'
      && run.build_and_runtime_passed && passedCoreTaskCount === coreTaskCount) : null;
    run.asr = run.tsr;
  }
}
