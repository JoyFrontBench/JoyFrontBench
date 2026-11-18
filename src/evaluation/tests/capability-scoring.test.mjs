import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPABILITY_DIMENSION_NAMES, loadCapabilityDimensions } from '../scripts/lib/capability-scoring.mjs';
import { parsePromptGroups } from '../scripts/lib/tasks.mjs';
import { scorePipelineRuns } from '../scripts/lib/scoring.mjs';
import { writePromptRepository } from './helpers/prompt-repository.mjs';

const questions = [
  {
    number: 1,
    id: 'frontenjoyai-001',
    tasks: [
      { task_id: '1', task: '完整实现', criteria: ['入口完整', '内容完整'] },
      { task_id: '2', task: '技术实现', criteria: ['代码符合要求'] },
      { task_id: '3', task: '视觉对比', judge_mode: 'pairwise_gsb', criteria: ['布局', '风格'] },
    ],
  },
  {
    number: 2,
    id: 'frontenjoyai-002',
    tasks: [{ task_id: '1', task: '完整实现', criteria: ['入口完整', '内容完整'] }],
  },
];

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'front-capability-score-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const promptsRoot = join(root, 'prompts');
  const runsRoot = join(root, 'runs');
  mkdirSync(runsRoot);
  writePromptRepository(promptsRoot, questions);
  const labelsPath = join(promptsRoot, 'capability-dimensions.json');
  const labels = {
    version: 2,
    method: {
      labeling: 'single-label',
      labeling_unit: 'task',
      dimensions: CAPABILITY_DIMENSION_NAMES.map((name) => ({ name, description: name })),
    },
    items: questions.flatMap((question) => question.tasks.map((task) => ({
      question_id: question.id,
      task_id: task.task_id,
      capability_dimension: task.judge_mode === 'pairwise_gsb' ? '视觉品质' : '组件完备',
    }))),
  };
  writeJson(labelsPath, labels);
  return { root, promptsRoot, runsRoot, outputRoot: join(root, 'scores'), labelsPath, labels };
}

function writeRun(fixture, {
  questionId = 'frontenjoyai-001',
  harness = 'openhands',
  model = 'candidate',
  runId = 'r1',
  directory,
  statuses = {},
  gsb = 'G',
  pairwiseStatus = 'completed',
  strictStatus = 'pass',
  issues = [],
  requirementResults,
  reference,
  pipelineStatus = 'ready',
} = {}) {
  const question = questions.find((item) => item.id === questionId);
  const runRoot = join(fixture.runsRoot, directory || `${harness}-${model}-${questionId}-${runId}`);
  mkdirSync(join(runRoot, 'reports'), { recursive: true });
  const runIdentity = { harness, model, run_id: runId };
  writeJson(join(runRoot, 'reports/eval-summary-results.json'), [{
    id: questionId,
    number: question.number,
    runIdentity,
    reference,
    requirementResults: requirementResults ?? question.tasks.map((task) => ({
      taskId: task.task_id,
      judgeMode: task.judge_mode || 'pointwise',
      status: task.judge_mode === 'pairwise_gsb' ? pairwiseStatus : 'completed',
      ...(task.judge_mode === 'pairwise_gsb' ? { gsb } : {}),
      criterionResults: task.criteria.map((text, index) => ({
        criterionId: `${task.task_id}.${index + 1}`,
        ...(task.judge_mode === 'pairwise_gsb' ? {} : { status: statuses[task.task_id]?.[index] ?? 'pass' }),
      })),
    })),
  }]);
  writeJson(join(runRoot, 'reports/eval-judge-results-strict.json'), { status: strictStatus, issues });
  writeJson(join(runRoot, 'pipeline-state.json'), {
    finalStatus: pipelineStatus,
    question: { id: questionId, number: question.number },
    runIdentity,
    reference,
  });
  return runRoot;
}

function score(fixture, expectedRuns = 3) {
  return scorePipelineRuns({ ...fixture, expectedRuns });
}

function dimension(result, name, { harness = 'openhands', model = 'candidate' } = {}) {
  return result.capability_dimensions.dimension_scores[harness]
    .find((entry) => entry.model === model).dimension_scores
    .find((entry) => entry.dimension === name);
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${expected}, got ${actual}`);
}

test('released labels load all 219 tasks and the eight official dimensions without revisions', () => {
  const promptsRoot = fileURLToPath(new URL('../../../data/', import.meta.url));
  const repository = parsePromptGroups(promptsRoot);
  const diagnostics = [];
  const labels = loadCapabilityDimensions({ promptsRoot, repository, diagnostics });
  assert.equal(labels.status, 'ready');
  assert.equal(labels.labelsByQuestion.size, 30);
  const taskLabels = [...labels.labelsByQuestion.values()].flatMap((values) => [...values.values()]);
  assert.equal(taskLabels.length, 219);
  assert.deepEqual(labels.dimensions.map(({ name }) => name), CAPABILITY_DIMENSION_NAMES);
  assert.deepEqual(CAPABILITY_DIMENSION_NAMES.map((name) => taskLabels.filter((label) => label === name).length), [30, 12, 26, 11, 31, 67, 34, 8]);
  assert.deepEqual(diagnostics, []);
});

test('all paper metrics match an independent oracle across the 30 released questions', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'front-released-dors-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const promptsRoot = fileURLToPath(new URL('../../../data/', import.meta.url));
  const repository = parsePromptGroups(promptsRoot);
  const labels = JSON.parse(readFileSync(join(promptsRoot, 'capability-dimensions.json'), 'utf8'));
  const corePolicy = JSON.parse(readFileSync(join(promptsRoot, 'core-criteria-policy.json'), 'utf8'));
  const expectedTaskScores = new Map();
  const expectedQuestionScores = new Map();
  const runsRoot = join(root, 'runs');
  for (const group of repository.groups) {
    for (let runIndex = 0; runIndex < 3; runIndex += 1) {
      if (runIndex === 2 && group.number % 4 === 0) continue;
      let taskScoreSum = 0;
      let coreCount = 0;
      let corePassed = 0;
      const buildPassed = group.number % 5 !== 0;
      const questionPolicy = corePolicy.questions.find((question) => question.question_id === group.id);
      const requirementResults = group.requirements.map((requirement, taskIndex) => {
        const pairwise = requirement.judgeMode === 'pairwise_gsb';
        const comparisonIndex = (group.number + taskIndex + runIndex) % 3;
        const outcomes = requirement.criterionIds.map((criterionId, criterionIndex) =>
          (runIndex === 0 && group.number % 3 === 0) || (group.number + taskIndex + criterionIndex + runIndex) % 13 < 11 ? 1 : 0);
        const taskScore = pairwise ? [1, 0.5, 0][comparisonIndex]
          : outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
        taskScoreSum += taskScore;
        const policyTask = questionPolicy.tasks.find((task) => task.task_id === requirement.taskId);
        const gating = policyTask.criteria.filter((criterion) => criterion.level === 'gating');
        if (!pairwise && gating.length) {
          coreCount += 1;
          const allGatingPassed = gating.every((criterion) => outcomes[requirement.criterionIds.indexOf(criterion.criterion_id)] === 1);
          if (allGatingPassed && taskScore >= 0.8) corePassed += 1;
        }
        const key = `${group.id}/${requirement.taskId}`;
        expectedTaskScores.set(key, (expectedTaskScores.get(key) || 0) + taskScore / 3);
        return {
          taskId: requirement.taskId,
          judgeMode: requirement.judgeMode,
          status: 'completed',
          ...(pairwise ? { gsb: ['G', 'S', 'B'][comparisonIndex] } : {}),
          criterionResults: requirement.criterionIds.map((criterionId, criterionIndex) => ({
            criterionId,
            ...(pairwise ? {} : { status: outcomes[criterionIndex] ? 'pass' : 'fail' }),
          })),
        };
      });
      const totals = expectedQuestionScores.get(group.id) || { ors: 0, ctpr: 0, tsr: 0 };
      totals.ors += taskScoreSum / group.requirements.length / 3;
      totals.ctpr += corePassed / coreCount / 3;
      totals.tsr += Number(buildPassed && corePassed === coreCount) / 3;
      expectedQuestionScores.set(group.id, totals);
      const reportsRoot = join(runsRoot, `${group.id}-r${runIndex + 1}`, 'reports');
      mkdirSync(reportsRoot, { recursive: true });
      writeJson(join(reportsRoot, 'runtime.json'), { passed: buildPassed });
      writeJson(join(reportsRoot, 'eval-summary-results.json'), [{
        buildAndRuntime: { status: buildPassed ? 'passed' : 'failed', reason: 'Synthetic runtime check.', evidence: [join(reportsRoot, 'runtime.json')] },
        id: group.id,
        number: group.number,
        runIdentity: { harness: 'oracle-test', model: 'synthetic-verdicts', run_id: `r${runIndex + 1}` },
        requirementResults,
      }]);
      writeJson(join(reportsRoot, 'eval-judge-results-strict.json'), { status: 'pass', issues: [] });
    }
  }
  const { result } = scorePipelineRuns({ promptsRoot, runsRoot, outputRoot: join(root, 'score'), expectedRuns: 3 });
  const model = result.leaderboards.official['oracle-test'][0];
  for (const [metric, originalMetric] of [['ats', 'ors'], ['ctpr', 'ctpr'], ['asr', 'tsr']]) {
    const expected = [...expectedQuestionScores.values()].reduce((sum, scores) => sum + scores[originalMetric], 0) / repository.groups.length;
    assertClose(model[metric], expected);
    assertClose(model[`${metric}_percent`], expected * 100);
    for (const question of model.question_scores) assertClose(question[metric], expectedQuestionScores.get(question.question_id)[originalMetric]);
  }
  assert.ok(model.asr > 0 && model.asr < model.ctpr);
  assert.equal(model.ats, model.ors);
  assert.equal(model.asr, model.tsr);
  assert.equal(result.run_details[0].ats, result.run_details[0].ors);
  assert.equal(result.run_details[0].asr, result.run_details[0].tsr);
  assert.equal(model.primary_metric, 'asr');
  assert.deepEqual(Object.keys(result.scoring_policy.metrics), ['ats', 'ctpr', 'asr', 'capability_scores']);
  assert.deepEqual(result.scoring_policy.legacy_metric_aliases, { ors: 'ats', tsr: 'asr', d_ors: 'capability_scores' });
  const dimensions = result.capability_dimensions.dimension_scores['oracle-test'][0].dimension_scores;
  assert.equal(dimensions.length, 8);
  assert.deepEqual(dimensions.map((dimension) => [dimension.name_en, dimension.abbreviation]), [
    ['Component Completeness', 'CC'], ['Representation Fidelity', 'RF'],
    ['Visual Quality', 'VQ'], ['Interaction Responsiveness', 'IR'],
    ['Computational Rendering', 'CR'], ['Rule Simulation', 'RS'],
    ['State Management', 'SM'], ['Data Exchange', 'DE'],
  ]);
  for (const item of dimensions) {
    const tasks = labels.items.filter((label) => label.capability_dimension === item.dimension);
    const expected = tasks.reduce((sum, task) => sum + expectedTaskScores.get(`${task.question_id}/${task.task_id}`), 0) / tasks.length;
    assertClose(item.score, expected);
    assertClose(item.score_percent, expected * 100);
    assert.equal(item.total_task_count, tasks.length);
    assert.equal(item.expected_task_run_count, tasks.length * 3);
    assert.equal(item.invalid_task_run_count, 0);
  }
  assert.equal(result.diagnostics.some((item) => item.severity === 'error'), false);
});

test('capability scores average scheduled runs before equally weighting tasks, not criteria or questions', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, { statuses: { '2': ['fail'] }, gsb: 'S' });
  writeRun(fixture, { runId: 'r2', statuses: { '1': ['fail', 'pass'] } });
  writeRun(fixture, { questionId: 'frontenjoyai-002', statuses: { '1': ['pass', 'fail'] } });
  writeRun(fixture, { harness: 'opencode', statuses: { '1': ['fail', 'fail'], '2': ['fail'] }, gsb: 'B' });
  writeRun(fixture, { model: 'other-model' });
  const output = score(fixture);
  const report = output.result.capability_dimensions;
  assert.equal(report.status, 'ready');
  assert.equal(report.metric, 'capability_scores');
  assert.equal(report.name, 'Capability Scores');
  assert.equal(report.scope, 'official');
  assert.equal(report.expected_runs_per_question, 3);
  const component = dimension(output.result, '组件完备');
  assertClose(component.score, ((1 + 0.5) / 3 + (0 + 1) / 3 + 0.5 / 3) / 3);
  assertClose(component.score, 1 / 3);
  assertClose(component.score_percent, 100 / 3);
  assert.equal(component.total_task_count, 3);
  assert.equal(component.valid_task_count, 3);
  assert.equal(component.question_count, 2);
  assert.equal(component.observed_task_run_count, 5);
  assert.equal(component.valid_task_run_count, 5);
  assert.equal(component.expected_task_run_count, 9);
  assert.equal(component.missing_task_run_count, 4);
  assert.equal(component.invalid_task_run_count, 0);
  assert.equal(dimension(output.result, '视觉品质').score, 0.5);
  assert.equal(dimension(output.result, '组件完备', { harness: 'opencode' }).score, 0);
  assertClose(dimension(output.result, '组件完备', { model: 'other-model' }).score, 2 / 9);
  for (const entry of report.dimension_scores.openhands) {
    assert.equal(entry.dimension_scores.length, 8);
    assert.equal(Object.hasOwn(entry, 'total_score'), false);
    assert.equal(Object.hasOwn(entry, 'rank'), false);
  }
  const empty = dimension(output.result, '规则仿真');
  assert.equal(empty.score, null);
  assert.equal(empty.score_percent, null);
  assert.equal(empty.total_task_count, 0);
  assert.equal(empty.expected_task_run_count, 0);
  const entry = output.result.leaderboards.official.openhands.find((item) => item.model === 'candidate');
  assert.deepEqual(entry.dimension_scores, report.dimension_scores.openhands.find((item) => item.model === 'candidate').dimension_scores);
  assert.equal(entry.dimension_score_metric, 'capability_scores');
  assert.equal(entry.dimension_score_scope, 'official');
  assert.deepEqual(output.result.leaderboards.experimental, {});
  const json = JSON.parse(readFileSync(output.jsonPath, 'utf8'));
  assert.deepEqual(json.capability_dimensions, report);
  assert.equal(json.source.capability_dimensions, fixture.labelsPath);
  assert.equal(JSON.parse(readFileSync(output.manifestPath, 'utf8')).capability_dimensions, fixture.labelsPath);
  const markdown = readFileSync(output.markdownPath, 'utf8');
  assert.match(markdown, /八维能力分数（Capability Scores）/u);
  assert.doesNotMatch(markdown, /\b(?:ORS|TSR|D-ORS)\b/u);
  assert.match(markdown, /组件完备 \| 33\.33 \| 3\/3 \| 2 \| 5\/5\/9/u);
  assert.match(markdown, /视觉品质 \| 50\.00/u);
  assert.match(markdown, /规则仿真 \| 不可用/u);
  assert.doesNotMatch(markdown, /未接入|\[object Object\]/u);
});

test('missing questions and scheduled runs stay in capability-score denominators', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture);
  const { result } = score(fixture);
  assertClose(dimension(result, '组件完备').score, 2 / 9);
  assertClose(dimension(result, '视觉品质').score, 1 / 3);
  assert.equal(dimension(result, '组件完备').missing_task_run_count, 7);
  assert.equal(dimension(result, '组件完备').valid_task_count, 2);
  assertClose(dimension(result, '组件完备').coverage, 2 / 3);
  const single = score(fixture, 1).result;
  assertClose(dimension(single, '组件完备').score, 2 / 3);
  assert.equal(dimension(single, '视觉品质').score, 1);
});

test('missing or duplicated pointwise criteria only zero their own contributions', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, {
    requirementResults: [
      { taskId: '1', judgeMode: 'pointwise', status: 'completed', criterionResults: [{ criterionId: '1.2', status: 'pass' }] },
      { taskId: '2', judgeMode: 'pointwise', status: 'completed', criterionResults: [{ criterionId: '2.1', status: 'pass' }] },
      { taskId: '3', judgeMode: 'pairwise_gsb', status: 'needs_review', gsb: null, criterionResults: [{ criterionId: '3.1' }, { criterionId: '3.2' }] },
    ],
  });
  writeRun(fixture, {
    model: 'duplicated-criterion',
    requirementResults: [
      { taskId: '1', judgeMode: 'pointwise', status: 'completed', criterionResults: [{ criterionId: '1.1', status: 'pass' }, { criterionId: '1.1', status: 'pass' }, { criterionId: '1.2', status: 'pass' }] },
      { taskId: '2', judgeMode: 'pointwise', status: 'completed', criterionResults: [{ criterionId: '2.1', status: 'pass' }] },
    ],
  });
  const { result } = score(fixture, 1);
  for (const model of ['candidate', 'duplicated-criterion']) {
    assert.equal(dimension(result, '组件完备', { model }).score, 0.5);
    assert.equal(dimension(result, '视觉品质', { model }).score, 0);
    const run = result.run_details.find((entry) => entry.model === model);
    assert.deepEqual(run.tasks.map((task) => task.score), [0.5, 1, 0]);
    assert.equal(run.scoring_status, 'partial');
  }
});

test('capability scores use zero-fill rather than effective-only for errored criteria and invalid GSB', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, { statuses: { '1': ['pass', 'error'] }, gsb: 'invalid' });
  const { result } = score(fixture, 1);
  assert.equal(result.run_details[0].tasks[0].effective_only, 1);
  assert.equal(result.run_details[0].tasks[0].score, 0.5);
  assert.equal(dimension(result, '组件完备').score, 0.5);
  assert.equal(dimension(result, '视觉品质').score, 0);
});

test('criterion-scoped evidence failures preserve other accepted criteria and tasks', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, {
    strictStatus: 'invalid',
    issues: [{ severity: 'high', id: 'frontenjoyai-001', taskId: '1.1', scope: 'criterion', message: 'Evidence is inadmissible.' }],
    gsb: 'S',
  });
  const { result } = score(fixture, 1);
  const run = result.run_details[0];
  assert.equal(run.audit_passed, false);
  assert.deepEqual(run.tasks.map((task) => task.score), [0.5, 1, 0.5]);
  assert.equal(run.tasks[0].audited_valid_item_count, 1);
  assert.equal(run.tasks[0].children[0].zero_fill, 1);
  assert.equal(dimension(result, '组件完备').score, 0.5);
  assert.equal(dimension(result, '视觉品质').score, 0.5);
  assert.equal(run.scoring_status, 'partial');
});

test('pairwise criterion audit failure zeroes the single task-level comparison', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, {
    strictStatus: 'invalid',
    issues: [{ severity: 'high', id: 'frontenjoyai-001', taskId: '3.2', scope: 'criterion' }],
  });
  const { result } = score(fixture, 1);
  assertClose(dimension(result, '组件完备').score, 2 / 3);
  assert.equal(dimension(result, '视觉品质').score, 0);
  assert.equal(dimension(result, '视觉品质').invalid_task_run_count, 1);
});

test('build failure does not erase independently audited source-level criteria', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, {
    pipelineStatus: 'failed',
    strictStatus: 'invalid',
    issues: ['1', '3'].map((taskId) => ({ severity: 'high', id: 'frontenjoyai-001', taskId, scope: 'evidence' })),
  });
  const { result } = score(fixture, 1);
  assert.deepEqual(result.run_details[0].tasks.map((task) => task.score), [0, 1, 0]);
  assertClose(dimension(result, '组件完备').score, 1 / 3);
});

for (const [name, issues] of [
  ['no localized findings', []],
  ['a whole-record failure', [{ severity: 'high', taskId: '', scope: 'group' }]],
  ['an unknown audit target', [{ severity: 'high', taskId: 'unknown-task', scope: 'criterion' }]],
]) {
  test(`unscorable audit with ${name} keeps the scheduled run at zero`, (context) => {
    const fixture = createFixture(context);
    writeRun(fixture, { strictStatus: 'invalid', issues });
    const { result } = score(fixture);
    assert.equal(dimension(result, '组件完备').score, 0);
    assert.equal(dimension(result, '视觉品质').score, 0);
    assert.equal(dimension(result, '组件完备').invalid_task_run_count, 2);
    assert.equal(result.run_details[0].scoring_status, 'unscorable');
  });
}

test('a missing strict audit cannot supply official capability scores', (context) => {
  const fixture = createFixture(context);
  const runRoot = writeRun(fixture);
  rmSync(join(runRoot, 'reports/eval-judge-results-strict.json'));
  const { result } = score(fixture, 1);
  assert.equal(dimension(result, '组件完备').score, 0);
  assert.equal(dimension(result, '视觉品质').score, 0);
});

test('an invalid JSON result retains its identity from pipeline state and scores zero', (context) => {
  const fixture = createFixture(context);
  const runRoot = writeRun(fixture);
  writeFileSync(join(runRoot, 'reports/eval-summary-results.json'), '{invalid');
  const { result } = score(fixture, 1);
  assert.equal(result.run_details.length, 1);
  assert.equal(result.run_details[0].scoring_status, 'unscorable');
  assert.equal(dimension(result, '组件完备').score, 0);
  assert.equal(dimension(result, '组件完备').observed_task_run_count, 2);
  assert.equal(dimension(result, '组件完备').invalid_task_run_count, 2);
  assert.ok(result.diagnostics.some((item) => item.code === 'invalid_result_json'));
});

test('an empty result array retains the scheduled identity instead of dropping the model', (context) => {
  const fixture = createFixture(context);
  const runRoot = writeRun(fixture);
  writeJson(join(runRoot, 'reports/eval-summary-results.json'), []);
  const { result } = score(fixture, 1);
  assert.equal(result.run_details.length, 1);
  assert.equal(result.run_details[0].scoring_status, 'unscorable');
  assert.equal(dimension(result, '组件完备').score, 0);
  assert.equal(dimension(result, '组件完备').observed_task_run_count, 2);
  assert.ok(result.diagnostics.some((item) => item.code === 'invalid_requirement_results'));
});

test('duplicate run identities occupy one zero-filled slot, never an extra or best run', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, { directory: 'duplicate-first' });
  writeRun(fixture, { directory: 'duplicate-second', statuses: { '1': ['fail', 'fail'] } });
  writeRun(fixture, { runId: 'r2' });
  const { result } = score(fixture);
  const component = dimension(result, '组件完备');
  assertClose(component.score, 2 / 9);
  assert.equal(component.observed_task_run_count, 4);
  assert.equal(component.invalid_task_run_count, 2);
  assert.equal(component.missing_task_run_count, 5);
  assertClose(dimension(result, '视觉品质').score, 1 / 3);
  assert.ok(result.diagnostics.some((item) => item.code === 'duplicate_run_identity'));
});

test('extra scheduled run slots are rejected rather than silently averaged or selected', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture);
  writeRun(fixture, { runId: 'r2' });
  assert.throws(() => score(fixture, 1), /Found 2 run slots.*exceeding --expected-runs=1/u);
});

test('custom-reference capability scores are explicitly experimental', (context) => {
  const fixture = createFixture(context);
  writeRun(fixture, { reference: { kind: 'custom', question_id: 'frontenjoyai-001', entry: 'index.html' } });
  const output = score(fixture, 1);
  assert.equal(output.result.capability_dimensions.scope, 'experimental');
  assert.equal(dimension(output.result, '视觉品质').score, 1);
  assert.deepEqual(output.result.leaderboards.official, {});
  assert.equal(output.result.leaderboards.experimental.openhands[0].dimension_score_scope, 'experimental');
  assert.match(readFileSync(output.markdownPath, 'utf8'), /自定义参考素材下的能力分数仅供实验比较，不是正式指标/u);
});

test('missing labels explicitly disable capability scores', (context) => {
  const fixture = createFixture(context);
  rmSync(fixture.labelsPath);
  writeRun(fixture);
  const output = score(fixture, 1);
  assert.equal(output.result.capability_dimensions.status, 'not_available');
  assert.equal(output.result.capability_dimensions.dimension_scores, null);
  assert.equal(output.result.leaderboards.official.openhands[0].dimension_scores, null);
  assert.ok(output.result.diagnostics.some((item) => item.code === 'capability_dimensions_not_found'));
  assert.match(readFileSync(output.markdownPath, 'utf8'), /标签不可用，未生成能力分数/u);
});

test('valid labels without run records do not fabricate model profiles', (context) => {
  const fixture = createFixture(context);
  const { result } = score(fixture);
  assert.equal(result.capability_dimensions.status, 'ready');
  assert.deepEqual(result.capability_dimensions.dimension_scores, {});
});

for (const [name, mutate, expectedError] of [
  ['old version', (document) => { document.version = 1; }, /version 2/u],
  ['criterion labels', (document) => { document.method.labeling_unit = 'criterion'; }, /task-level/u],
  ['multi-label taxonomy', (document) => { document.method.labeling = 'multi-label'; }, /single-label/u],
  ['missing dimension', (document) => { document.method.dimensions.pop(); }, /eight published dimensions/u],
  ['duplicate dimension', (document) => { document.method.dimensions[1] = document.method.dimensions[0]; }, /eight published dimensions/u],
  ['unknown dimension', (document) => { document.method.dimensions[0].name = '旧维度'; }, /eight published dimensions/u],
  ['missing items', (document) => { delete document.items; }, /items array/u],
  ['unknown question', (document) => { document.items[0].question_id = 'unknown'; }, /unknown question_id/u],
  ['unknown task', (document) => { document.items[0].task_id = '99'; }, /unknown task_id/u],
  ['duplicate task', (document) => { document.items.push(document.items[0]); }, /duplicate task label/u],
  ['missing task', (document) => { document.items.pop(); }, /missing a task label/u],
  ['unreviewed task', (document) => { document.items[0].capability_dimension = '待人工判定'; }, /invalid or unreviewed label/u],
]) {
  test(`capability metadata rejects ${name}`, (context) => {
    const fixture = createFixture(context);
    mutate(fixture.labels);
    writeJson(fixture.labelsPath, fixture.labels);
    assert.throws(() => score(fixture), expectedError);
  });
}

test('malformed label JSON is a clear error', (context) => {
  const fixture = createFixture(context);
  writeFileSync(fixture.labelsPath, '{invalid');
  assert.throws(() => score(fixture), /Invalid capability dimensions JSON/u);
});
