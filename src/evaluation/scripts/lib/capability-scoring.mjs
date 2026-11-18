import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CAPABILITY_DIMENSIONS = [
  { name: '组件完备', name_en: 'Component Completeness', abbreviation: 'CC' },
  { name: '表征保真', name_en: 'Representation Fidelity', abbreviation: 'RF' },
  { name: '视觉品质', name_en: 'Visual Quality', abbreviation: 'VQ' },
  { name: '交互响应', name_en: 'Interaction Responsiveness', abbreviation: 'IR' },
  { name: '计算渲染', name_en: 'Computational Rendering', abbreviation: 'CR' },
  { name: '规则仿真', name_en: 'Rule Simulation', abbreviation: 'RS' },
  { name: '状态管理', name_en: 'State Management', abbreviation: 'SM' },
  { name: '数据交换', name_en: 'Data Exchange', abbreviation: 'DE' },
];
export const CAPABILITY_DIMENSION_NAMES = CAPABILITY_DIMENSIONS.map(({ name }) => name);

export function loadCapabilityDimensions({ promptsRoot, repository, diagnostics }) {
  const path = join(promptsRoot, 'capability-dimensions.json');
  if (!existsSync(path)) {
    diagnostics.push({
      severity: 'warning',
      code: 'capability_dimensions_not_found',
      message: `Capability scores are unavailable because capability labels were not found: ${path}`,
      capability_dimensions_path: path,
    });
    return { status: 'not_available', path, dimensions: [], labelsByQuestion: new Map() };
  }
  if (!statSync(path).isFile()) {
    throw new Error(`Capability dimensions must be a file: ${path}`);
  }
  let document;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid capability dimensions JSON ${path}: ${error.message}`);
  }
  if (Number(document?.version) !== 2) {
    throw new Error('Capability dimensions require version 2.');
  }
  if (document.method?.labeling_unit !== 'task' || document.method?.labeling !== 'single-label') {
    throw new Error('Capability dimensions require single-label, task-level annotations.');
  }
  const dimensions = document.method?.dimensions;
  if (!Array.isArray(dimensions)
    || dimensions.length !== CAPABILITY_DIMENSION_NAMES.length
    || new Set(dimensions.map((dimension) => dimension?.name)).size !== dimensions.length
    || dimensions.some((dimension) => !CAPABILITY_DIMENSION_NAMES.includes(dimension?.name))) {
    throw new Error('Capability dimensions must define exactly the eight published dimensions.');
  }
  if (!Array.isArray(document.items)) {
    throw new Error('Capability dimensions have no items array.');
  }
  const expectedTasks = new Map(repository.groups.map((group) => [
    group.id,
    new Set(group.requirements.map((requirement) => String(requirement.taskId))),
  ]));
  const labelsByQuestion = new Map(repository.groups.map((group) => [group.id, new Map()]));
  for (const item of document.items) {
    const questionId = item?.question_id;
    const taskId = item?.task_id;
    if (!expectedTasks.has(questionId)) {
      throw new Error(`Capability dimensions contain an unknown question_id: ${questionId}`);
    }
    if (!expectedTasks.get(questionId).has(taskId)) {
      throw new Error(`Capability dimensions contain an unknown task_id: ${questionId}/${taskId}`);
    }
    const labels = labelsByQuestion.get(questionId);
    if (labels.has(taskId)) {
      throw new Error(`Capability dimensions contain a duplicate task label: ${questionId}/${taskId}`);
    }
    if (!CAPABILITY_DIMENSION_NAMES.includes(item.capability_dimension)) {
      throw new Error(`Capability dimensions contain an invalid or unreviewed label: ${questionId}/${taskId}: ${item.capability_dimension}`);
    }
    labels.set(taskId, item.capability_dimension);
  }
  for (const [questionId, taskIds] of expectedTasks) {
    for (const taskId of taskIds) {
      if (!labelsByQuestion.get(questionId).has(taskId)) {
        throw new Error(`Capability dimensions are missing a task label: ${questionId}/${taskId}`);
      }
    }
  }
  return {
    status: 'ready',
    path,
    version: document.version,
    dimensions: CAPABILITY_DIMENSIONS.map((dimension) => ({
      ...dimensions.find(({ name }) => name === dimension.name),
      ...dimension,
    })),
    labelsByQuestion,
  };
}

function aggregateCapabilityModel({ cohort, labels, expectedRuns }) {
  const taskScores = [];
  for (const { group, runs, observed_run_count: observedRuns } of cohort.questions) {
    for (const requirement of group.requirements) {
      const taskId = String(requirement.taskId);
      const observedTasks = runs.map((run) => run?.tasks.find((task) => task.task_id === taskId));
      taskScores.push({
        question_id: group.id,
        dimension: labels.labelsByQuestion.get(group.id).get(taskId),
        score: observedTasks.reduce((sum, task) => sum + (task?.score ?? 0), 0) / expectedRuns,
        observed_runs: observedRuns,
        valid_runs: observedTasks.filter((task) => task?.audited_valid_item_count > 0).length,
      });
    }
  }
  return {
    harness: cohort.harness,
    model: cohort.model,
    dimension_scores: labels.dimensions.map(({ name, name_en: nameEn, abbreviation }) => {
      const tasks = taskScores.filter((task) => task.dimension === name);
      const score = tasks.length ? tasks.reduce((sum, task) => sum + task.score, 0) / tasks.length : null;
      const validTasks = tasks.filter((task) => task.valid_runs > 0).length;
      const observedRuns = tasks.reduce((sum, task) => sum + task.observed_runs, 0);
      const validRuns = tasks.reduce((sum, task) => sum + task.valid_runs, 0);
      const expectedTaskRuns = tasks.length * expectedRuns;
      return {
        dimension: name,
        name_en: nameEn,
        abbreviation,
        score,
        score_percent: score === null ? null : score * 100,
        total_task_count: tasks.length,
        valid_task_count: validTasks,
        coverage: tasks.length ? validTasks / tasks.length : 0,
        question_count: new Set(tasks.map((task) => task.question_id)).size,
        observed_task_run_count: observedRuns,
        valid_task_run_count: validRuns,
        expected_task_run_count: expectedTaskRuns,
        missing_task_run_count: expectedTaskRuns - observedRuns,
        invalid_task_run_count: observedRuns - validRuns,
      };
    }),
  };
}

export function buildCapabilityDimensionReport({ runDetails, cohorts, labels, expectedRuns, referenceSet }) {
  const report = {
    status: labels.status,
    metric: 'capability_scores',
    name: 'Capability Scores',
    scope: referenceSet.kind === 'custom' ? 'experimental' : 'official',
    labels_path: labels.path,
    labels_version: labels.version ?? null,
    expected_runs_per_question: expectedRuns,
    dimensions: labels.dimensions,
    dimension_scores: null,
  };
  if (labels.status !== 'ready') return report;
  for (const run of runDetails) {
    const taskLabels = labels.labelsByQuestion.get(run.question_id);
    for (const task of run.tasks) task.capability_dimension = taskLabels?.get(task.task_id) ?? null;
  }
  const dimensionScores = new Map();
  for (const cohort of cohorts) {
    if (!dimensionScores.has(cohort.harness)) dimensionScores.set(cohort.harness, []);
    dimensionScores.get(cohort.harness).push(aggregateCapabilityModel({ cohort, labels, expectedRuns }));
  }
  report.dimension_scores = Object.fromEntries(dimensionScores);
  return report;
}
