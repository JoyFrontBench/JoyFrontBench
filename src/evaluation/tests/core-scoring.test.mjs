import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parsePromptGroups } from '../scripts/lib/tasks.mjs';
import { scorePipelineRuns } from '../scripts/lib/scoring.mjs';
import { parseCommandArgs } from '../scripts/lib/config.mjs';
import { loadCoreScoringPolicy } from '../scripts/lib/core-scoring.mjs';
import { CAPABILITY_DIMENSION_NAMES } from '../scripts/lib/capability-scoring.mjs';

import { writePromptRepository as writeJsonPromptRepository } from './helpers/prompt-repository.mjs';

function writeStrictPromptRepository(root) {
  writeJsonPromptRepository(root, [{
    number: 1,
    id: 'frontenjoyai-001',
    categories: ['数据可视化'],
    prompt: '实现数据页面。\n',
    tasks: [
      { task_id: '1', task: '完成核心工作流', criteria: ['核心入口可用', '主流程成功', '结果正确', '辅助反馈完整', '视觉细节完整'] },
      { task_id: '2', judge_mode: 'pairwise_gsb', task: '与标杆比较', criteria: ['比较视觉和交互完成度'] },
    ],
  }]);

  writeFileSync(join(root, 'core-criteria-policy.json'), `${JSON.stringify({
    version: 2,
    kind: 'core-criteria-policy',
    review_required: false,
    summary: {
      questions: 1,
      tasks: 2,
      core_tasks: 1,
      criteria: 6,
      gating: 1,
      should: 3,
      quality: 2,
    },
    questions: [
      {
        question_no: '001',
        question_id: 'frontenjoyai-001',
        core_task_ids: ['1'],
        tasks: [
          {
            task_id: '1',
            judge_mode: 'pointwise',
            task: '完成核心工作流',
            derived_level: 'gating',
            is_core_task: true,
            core_gate_scope: 'criteria',
            criteria: [
              { criterion_id: '1.1', criterion: '核心入口可用', level: 'gating' },
              { criterion_id: '1.2', criterion: '主流程成功', level: 'should' },
              { criterion_id: '1.3', criterion: '结果正确', level: 'should' },
              { criterion_id: '1.4', criterion: '辅助反馈完整', level: 'should' },
              { criterion_id: '1.5', criterion: '视觉细节完整', level: 'quality' },
            ],
          },
          {
            task_id: '2',
            judge_mode: 'pairwise_gsb',
            task: '与标杆比较',
            derived_level: 'quality',
            is_core_task: false,
            core_gate_scope: 'task',
            criteria: [
              {
                criterion_id: '2.1',
                criterion: '比较视觉和交互完成度',
                level: 'quality',
              },
            ],
          },
        ],
      },
    ],
  }, null, 2)}\n`);
  writeFileSync(join(root, 'capability-dimensions.json'), `${JSON.stringify({
    version: 2,
    method: {
      labeling: 'single-label',
      labeling_unit: 'task',
      dimensions: CAPABILITY_DIMENSION_NAMES.map((name) => ({ name, description: name })),
    },
    items: [
      { question_id: 'frontenjoyai-001', task_id: '1', capability_dimension: '组件完备' },
      { question_id: 'frontenjoyai-001', task_id: '2', capability_dimension: '视觉品质' },
    ],
  }, null, 2)}\n`);
}

function writeRun({ runsRoot, directory, model, strictStatus, statuses, gsb = 'B', runId = `${model}-r1`, buildStatus = 'passed', issues = [] }) {
  const runRoot = join(runsRoot, directory);
  const runIdentity = {
    harness: 'direct',
    model,
    question: '001',
    run_id: runId,
  };
  mkdirSync(join(runRoot, 'reports'), { recursive: true });
  writeFileSync(join(runRoot, 'reports/eval-summary-results.json'), `${JSON.stringify([{
    id: 'frontenjoyai-001',
    number: 1,
    row: 2,
    runIdentity,
    ...(buildStatus === null ? {} : { buildAndRuntime: { status: buildStatus, reason: 'Fixture build and browser check.', evidence: [join(runRoot, 'runtime.json')] } }),
    requirementResults: [
      {
        taskId: '1',
        judgeMode: 'pointwise',
        status: 'completed',
        criterionResults: statuses.map((status, index) => ({
          criterionId: `1.${index + 1}`,
          status,
        })),
      },
      {
        taskId: '2',
        judgeMode: 'pairwise_gsb',
        status: 'completed',
        gsb,
        criterionResults: [{ criterionId: '2.1', reason: '完成对比。' }],
      },
    ],
  }], null, 2)}\n`);
  writeFileSync(join(runRoot, 'pipeline-state.json'), `${JSON.stringify({
    finalStatus: strictStatus === 'pass' ? 'ready' : 'needs-followup',
    question: { id: 'frontenjoyai-001', number: 1 },
    runIdentity,
  }, null, 2)}\n`);
  writeFileSync(join(runRoot, 'reports/eval-judge-results-strict.json'), `${JSON.stringify({
    status: strictStatus,
    counts: strictStatus === 'pass'
      ? { high: 0, medium: 0, low: 0 }
      : { high: 1, medium: 0, low: 0 },
    issues,
  }, null, 2)}\n`);
  writeFileSync(join(runRoot, 'runtime.json'), JSON.stringify({ status: buildStatus }));
  return runRoot;
}

function createScoringFixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'front-paper-metrics-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = { root, promptsRoot: join(root, 'prompts'), runsRoot: join(root, 'runs'), outputRoot: join(root, 'score') };
  writeStrictPromptRepository(fixture.promptsRoot);
  mkdirSync(fixture.runsRoot);
  return fixture;
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

test('all aggregate metrics retain missing scheduled run slots in their denominators', (context) => {
  const fixture = createScoringFixture(context);
  writeRun({ ...fixture, directory: 'first', model: 'candidate', runId: 'r1', strictStatus: 'pass', statuses: ['pass', 'pass', 'pass', 'pass', 'pass'], gsb: 'G' });
  writeRun({ ...fixture, directory: 'second', model: 'candidate', runId: 'r2', strictStatus: 'pass', statuses: ['fail', 'pass', 'pass', 'pass', 'pass'], gsb: 'S' });
  const { result, markdownPath } = scorePipelineRuns({ ...fixture, expectedRuns: 3 });
  const model = result.leaderboards.official.direct[0];
  assertClose(model.ors, (1 + 0.65) / 3);
  assertClose(model.ctpr, 1 / 3);
  assertClose(model.tsr, 1 / 3);
  assert.equal(model.question_scores[0].missing_run_count, 1);
  assert.equal(model.run_count, 2);
  assert.match(readFileSync(markdownPath, 'utf8'), /55\.00 \| 33\.33 \| 33\.33/u);
});

for (const buildStatus of ['failed', 'unverified', null]) {
  test(`runtime ${buildStatus ?? 'missing'} blocks only ASR, not accepted ATS or CTPR`, (context) => {
    const fixture = createScoringFixture(context);
    writeRun({ ...fixture, directory: 'run', model: 'candidate', strictStatus: 'pass', buildStatus, statuses: ['pass', 'pass', 'pass', 'pass', 'pass'], gsb: 'G' });
    const { result } = scorePipelineRuns({ ...fixture, expectedRuns: 1 });
    const model = result.leaderboards.official.direct[0];
    assert.equal(model.ors, 1);
    assert.equal(model.ctpr, 1);
    assert.equal(model.tsr, 0);
    assert.equal(result.run_details[0].build_and_runtime_passed, false);
  });
}

for (const [name, issue, expected] of [
  ['non-core pairwise evidence', { taskId: '2.1', scope: 'criterion' }, [0.5, 1, 1]],
  ['gating evidence', { taskId: '1.1', scope: 'criterion' }, [0.9, 0, 0]],
  ['non-gating evidence at the inclusive threshold', { taskId: '1.5', scope: 'criterion' }, [0.9, 1, 1]],
  ['runtime evidence', { taskId: '', scope: 'runtime' }, [1, 1, 0]],
]) {
  test(`localized ${name} does not discard unrelated accepted judgments`, (context) => {
    const fixture = createScoringFixture(context);
    writeRun({ ...fixture, directory: 'run', model: 'candidate', strictStatus: 'invalid', statuses: ['pass', 'pass', 'pass', 'pass', 'pass'], gsb: 'G', issues: [{ ...issue, severity: 'high', id: 'frontenjoyai-001' }] });
    const { result } = scorePipelineRuns({ ...fixture, expectedRuns: 1 });
    const model = result.leaderboards.official.direct[0];
    for (const [index, metric] of ['ors', 'ctpr', 'tsr'].entries()) assertClose(model[metric], expected[index]);
    assert.equal(result.run_details[0].audit_passed, false);
  });
}

test('duplicate run identities occupy one zero-filled slot for every metric', (context) => {
  const fixture = createScoringFixture(context);
  for (const [directory, runId] of [['first', 'r1'], ['duplicate', 'r1'], ['second', 'r2']]) {
    writeRun({ ...fixture, directory, model: 'candidate', runId, strictStatus: 'pass', statuses: ['pass', 'pass', 'pass', 'pass', 'pass'], gsb: 'G' });
  }
  const { result } = scorePipelineRuns({ ...fixture, expectedRuns: 3 });
  const model = result.leaderboards.official.direct[0];
  for (const metric of ['ors', 'ctpr', 'tsr']) assertClose(model[metric], 1 / 3);
  assert.equal(model.run_count, 2);
  assert.equal(result.source.discovered_run_count, 3);
});

test('excess run slots are rejected even when capability labels are absent', (context) => {
  const fixture = createScoringFixture(context);
  rmSync(join(fixture.promptsRoot, 'capability-dimensions.json'));
  for (const runId of ['r1', 'r2']) writeRun({ ...fixture, directory: runId, model: 'candidate', runId, strictStatus: 'pass', statuses: ['pass', 'pass', 'pass', 'pass', 'pass'] });
  assert.throws(() => scorePipelineRuns({ ...fixture, expectedRuns: 1 }), /exceeding --expected-runs=1/u);
});

for (const invalidResult of ['missing', 'malformed']) {
  test(`${invalidResult} results retain their scheduled identity and all three zero scores`, (context) => {
    const fixture = createScoringFixture(context);
    const runRoot = writeRun({ ...fixture, directory: 'run', model: 'candidate', strictStatus: 'pass', statuses: ['pass', 'pass', 'pass', 'pass', 'pass'] });
    const path = join(runRoot, 'reports/eval-summary-results.json');
    if (invalidResult === 'missing') rmSync(path);
    else writeFileSync(path, '{broken');
    const { result } = scorePipelineRuns({ ...fixture, expectedRuns: 3 });
    const model = result.leaderboards.official.direct[0];
    for (const metric of ['ors', 'ctpr', 'tsr']) assert.equal(model[metric], 0);
    assert.equal(model.run_count, 1);
    assert.equal(result.run_details[0].scoring_status, 'unscorable');
  });
}

test('a wholly failed batch remains visible through its scheduled matrix', (context) => {
  const fixture = createScoringFixture(context);
  writeFileSync(join(fixture.root, 'batch-state.json'), JSON.stringify({
    harness: 'direct', model: 'candidate', runs_root: fixture.runsRoot,
    entries: [{ question_no: 1, question_id: 'frontenjoyai-001', run_id: 'r1', output_root: join(fixture.runsRoot, 'r1/frontenjoyai-001'), status: 'error' }],
  }));
  const { result } = scorePipelineRuns({ ...fixture, expectedRuns: 3 });
  const model = result.leaderboards.official.direct[0];
  assert.equal(model.model, 'candidate');
  for (const metric of ['ors', 'ctpr', 'tsr']) assert.equal(model[metric], 0);
  assert.equal(result.run_details[0].result_path, null);
});

test('ASR ties are not broken by ATS or coverage', (context) => {
  const fixture = createScoringFixture(context);
  writeRun({ ...fixture, directory: 'low', model: 'low-ors', strictStatus: 'pass', statuses: ['pass', 'pass', 'pass', 'pass', 'fail'], gsb: 'B' });
  writeRun({ ...fixture, directory: 'high', model: 'high-ors', strictStatus: 'pass', statuses: ['pass', 'pass', 'pass', 'pass', 'pass'], gsb: 'G' });
  const { result } = scorePipelineRuns({ ...fixture, expectedRuns: 1 });
  const models = result.leaderboards.official.direct;
  assert.notEqual(models[0].ors, models[1].ors);
  assert.deepEqual(models.map((model) => model.rank), [1, 1]);
});

test('invalid scheduled denominators and malformed batch matrices are rejected', (context) => {
  const fixture = createScoringFixture(context);
  for (const expectedRuns of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => scorePipelineRuns({ ...fixture, expectedRuns }), /positive integer/u);
  }
  writeFileSync(join(fixture.root, 'batch-state.json'), '{broken');
  assert.throws(() => scorePipelineRuns({ ...fixture, expectedRuns: 3 }), /Invalid scheduled batch state/u);
});

test('final score args accept an explicit core policy', () => {
  const options = parseCommandArgs('score:final', [
    '--prompts=/prompts',
    '--runs-root=/runs',
    '--output-root=/output',
    '--core-policy=/policy.json',
    '--expected-runs=2',
  ]);
  assert.equal(options.corePolicyPath, '/policy.json');
  assert.equal(options.expectedRuns, 2);
});

test('core policy loads using only scoring metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-core-policy-'));
  try {
    writeStrictPromptRepository(root);
    const policyPath = join(root, 'core-criteria-policy.json');
    const document = JSON.parse(readFileSync(policyPath, 'utf8'));
    const diagnostics = [];
    const policy = loadCoreScoringPolicy({
      promptsRoot: root,
      repository: parsePromptGroups(root),
      diagnostics,
    });

    assert.equal(Object.hasOwn(document, 'source'), false);
    assert.equal(policy.status, 'ready');
    assert.equal(policy.path, policyPath);
    assert.equal(policy.summary.criteria, 6);
    assert.deepEqual(diagnostics, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core policy accepts dataset formatting changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-core-policy-'));
  try {
    writeStrictPromptRepository(root);
    const datasetPath = join(root, 'dataset.json');
    const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
    writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 4)}\n`);

    const policy = loadCoreScoringPolicy({
      promptsRoot: root,
      repository: parsePromptGroups(root),
      diagnostics: [],
    });
    assert.equal(policy.status, 'ready');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core policy still rejects changed rubric text', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-core-policy-'));
  try {
    writeStrictPromptRepository(root);
    const judgePath = join(root, 'judge/frontenjoyai-001.json');
    const judge = JSON.parse(readFileSync(judgePath, 'utf8'));
    judge.tasks[0].criteria[0].text = '新的核心入口要求';
    writeFileSync(judgePath, `${JSON.stringify(judge, null, 2)}\n`);

    assert.throws(() => loadCoreScoringPolicy({
      promptsRoot: root,
      repository: parsePromptGroups(root),
      diagnostics: [],
    }), /criterion text mismatch/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, mutate, pattern] of [
  ['question ID', (policy) => { policy.questions[0].question_id = 'frontenjoyai-002'; }, /unknown question_id/u],
  ['duplicate question ID', (policy) => { policy.questions.push(structuredClone(policy.questions[0])); }, /duplicate question_id/u],
  ['question number', (policy) => { policy.questions[0].question_no = '002'; }, /question number mismatch/u],
  ['missing question', (policy) => { policy.questions = []; }, /missing prompt questions/u],
  ['missing task', (policy) => { policy.questions[0].tasks.pop(); }, /task count mismatch/u],
  ['task ID', (policy) => { policy.questions[0].tasks[0].task_id = '3'; }, /missing task_id/u],
  ['duplicate task ID', (policy) => { policy.questions[0].tasks[1].task_id = '1'; }, /duplicate task_id/u],
  ['task text', (policy) => { policy.questions[0].tasks[0].task = '另一个任务'; }, /task text mismatch/u],
  ['judge mode', (policy) => { policy.questions[0].tasks[0].judge_mode = 'pairwise_gsb'; }, /judge_mode mismatch/u],
  ['criterion count', (policy) => { policy.questions[0].tasks[0].criteria.pop(); }, /criterion count mismatch/u],
  ['criterion ID', (policy) => { policy.questions[0].tasks[0].criteria[0].criterion_id = '1.99'; }, /criterion id mismatch/u],
  ['criterion text', (policy) => { policy.questions[0].tasks[0].criteria[0].criterion = '另一个要求'; }, /criterion text mismatch/u],
  ['core task flag', (policy) => { policy.questions[0].tasks[0].is_core_task = false; }, /is_core_task mismatch/u],
  ['derived level', (policy) => { policy.questions[0].tasks[0].derived_level = 'quality'; }, /derived_level mismatch/u],
  ['gate scope', (policy) => { policy.questions[0].tasks[0].core_gate_scope = 'task'; }, /core_gate_scope mismatch/u],
  ['declared core tasks', (policy) => { policy.questions[0].core_task_ids = []; }, /core_task_ids mismatch/u],
  ['pairwise gating', (policy) => { policy.questions[0].tasks[1].criteria[0].level = 'gating'; }, /Pairwise criterion cannot be gating/u],
  ['summary counts', (policy) => { policy.summary.gating = 0; }, /summary mismatch/u],
]) {
  test(`core policy rejects ${label} mismatches without revision metadata`, () => {
    const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-core-policy-'));
    try {
      writeStrictPromptRepository(root);
      const policyPath = join(root, 'core-criteria-policy.json');
      const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
      mutate(policy);
      writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

      assert.throws(() => loadCoreScoringPolicy({
        promptsRoot: root,
        repository: parsePromptGroups(root),
        diagnostics: [],
      }), pattern);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('core policy rejects legacy kind, version, and levels', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-core-policy-'));
  try {
    writeStrictPromptRepository(root);
    const repository = parsePromptGroups(root);
    const policyPath = join(root, 'core-criteria-policy.json');
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
    const load = () => loadCoreScoringPolicy({
      promptsRoot: root,
      configuredPath: policyPath,
      repository,
      diagnostics: [],
    });

    writeFileSync(policyPath, `${JSON.stringify({ ...policy, kind: 'core-task-judge-policy' })}\n`);
    assert.throws(load, /unsupported kind/u);
    writeFileSync(policyPath, `${JSON.stringify({ ...policy, version: 1 })}\n`);
    assert.throws(load, /unsupported version/u);
    policy.questions[0].tasks[0].criteria[0].level = 'must';
    writeFileSync(policyPath, `${JSON.stringify(policy)}\n`);
    assert.throws(load, /invalid level/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ASR loads the default policy and enforces core-task acceptance', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-core-metrics-'));
  const promptsRoot = join(root, 'prompts');
  const runsRoot = join(root, 'runs');
  const outputRoot = join(root, 'score');
  writeStrictPromptRepository(promptsRoot);
  mkdirSync(runsRoot, { recursive: true });

  writeRun({
    runsRoot,
    directory: 'threshold-pass',
    model: 'threshold-pass',
    strictStatus: 'pass',
    statuses: ['pass', 'pass', 'pass', 'pass', 'fail'],
  });
  writeRun({
    runsRoot,
    directory: 'gating-fail',
    model: 'gating-fail',
    strictStatus: 'pass',
    statuses: ['fail', 'pass', 'pass', 'pass', 'pass'],
  });
  writeRun({
    runsRoot,
    directory: 'threshold-fail',
    model: 'threshold-fail',
    strictStatus: 'pass',
    statuses: ['pass', 'pass', 'pass', 'fail', 'fail'],
  });
  writeRun({
    runsRoot,
    directory: 'strict-invalid',
    model: 'strict-invalid',
    strictStatus: 'invalid',
    statuses: ['pass', 'pass', 'pass', 'pass', 'pass'],
    gsb: 'G',
  });

  try {
    const scored = scorePipelineRuns({
      promptsRoot,
      runsRoot,
      outputRoot,
      expectedRuns: 1,
    });
    assert.equal(scored.result.scoring_policy.primary_metric, 'asr');
    assert.equal(scored.result.scoring_policy.completion_threshold, 0.8);
    assert.equal(scored.result.core_scoring.status, 'ready');
    assert.equal(scored.result.core_scoring.summary.core_tasks, 1);

    const runsByModel = new Map(
      scored.result.run_details.map((run) => [run.model, run]),
    );
    const thresholdPass = runsByModel.get('threshold-pass');
    assert.equal(thresholdPass.tasks[0].core_completion, 0.8);
    assert.equal(thresholdPass.tasks[0].core_task_pass, true);
    assert.equal(thresholdPass.tasks[1].is_core_task, false);
    assert.equal(thresholdPass.tasks[1].gsb, 'B');
    assert.equal(thresholdPass.tsr, 1);
    assert.equal(thresholdPass.asr, 1);
    assert.equal(thresholdPass.ats, thresholdPass.ors);

    const gatingFail = runsByModel.get('gating-fail');
    assert.equal(gatingFail.tasks[0].core_completion, 0.8);
    assert.equal(gatingFail.gating_pass_rate, 0);
    assert.equal(gatingFail.tsr, 0);
    assert.deepEqual(gatingFail.failed_core_task_ids, ['1']);

    const thresholdFail = runsByModel.get('threshold-fail');
    assert.equal(thresholdFail.gating_pass_rate, 1);
    assert.equal(thresholdFail.tasks[0].core_completion, 0.6);
    assert.equal(thresholdFail.tsr, 0);

    const strictInvalid = runsByModel.get('strict-invalid');
    assert.equal(strictInvalid.audit_passed, false);
    assert.equal(strictInvalid.tsr, 0);
    assert.equal(strictInvalid.ctpr, 0);

    const leaderboard = scored.result.leaderboards.official.direct;
    assert.equal(leaderboard.length, 4);
    assert.equal(leaderboard.find((entry) => entry.model === 'threshold-pass').tsr, 1);
    assert.equal(leaderboard.find((entry) => entry.model === 'gating-fail').tsr, 0);
    assert.equal(leaderboard.find((entry) => entry.model === 'threshold-fail').tsr, 0);
    assert.equal(leaderboard.find((entry) => entry.model === 'strict-invalid').tsr, 0);
    assert.equal(scored.result.capability_dimensions.status, 'ready');
    for (const [model, expectedScore] of [
      ['threshold-pass', 0.8], ['gating-fail', 0.8], ['threshold-fail', 0.6], ['strict-invalid', 0],
    ]) {
      const entry = leaderboard.find((item) => item.model === model);
      assert.equal(entry.dimension_scores.find((item) => item.dimension === '组件完备').score, expectedScore);
      assert.equal(entry.dimension_score_metric, 'capability_scores');
      assert.deepEqual(entry.dimension_scores, scored.result.capability_dimensions.dimension_scores.direct
        .find((item) => item.model === model).dimension_scores);
    }

    const markdown = readFileSync(scored.markdownPath, 'utf8');
    assert.match(markdown, /## 正式榜/u);
    assert.match(markdown, /CTPR/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
