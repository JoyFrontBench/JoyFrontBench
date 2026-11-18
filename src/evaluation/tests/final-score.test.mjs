import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scorePipelineRuns } from '../scripts/lib/scoring.mjs';

import { writePromptRepository as writeJsonPromptRepository } from './helpers/prompt-repository.mjs';

function writePromptRepository(root) {
  writeJsonPromptRepository(root, [
    {
      number: 1,
      id: 'frontenjoyai-001',
      categories: ['数据可视化'],
      prompt: '实现数据页面。\n',
      tasks: [
        { task_id: '1', task: '功能完整', criteria: ['子项一通过', '子项二通过'] },
        { task_id: '2', task: '交互正确', criteria: ['子项三通过'] },
      ],
    },
    {
      number: 2,
      id: 'frontenjoyai-002',
      categories: ['网页'],
      prompt: '实现网页。\n',
      tasks: [{ task_id: '1', judge_mode: 'pairwise_gsb', task: '与标杆比较', criteria: ['比较视觉和交互完成度'] }],
    },
  ]);
}

function writeRun({
  runsRoot,
  directory,
  id,
  number,
  row,
  model,
  runId,
  strictStatus,
  requirementResults,
  reference,
}) {
  const runRoot = join(runsRoot, directory);
  mkdirSync(join(runRoot, 'reports'), { recursive: true });
  const runIdentity = {
    harness: 'direct',
    model,
    question: String(number).padStart(3, '0'),
    run_id: runId,
  };
  writeFileSync(join(runRoot, 'reports/eval-summary-results.json'), `${JSON.stringify([{
    id,
    number,
    row,
    runIdentity,
    requirementResults,
    reference,
  }], null, 2)}\n`);
  writeFileSync(join(runRoot, 'pipeline-state.json'), `${JSON.stringify({
    finalStatus: strictStatus === 'pass' ? 'ready' : 'needs-followup',
    question: { id, number },
    runIdentity,
    reference,
  }, null, 2)}\n`);
  writeFileSync(join(runRoot, 'reports/eval-judge-results-strict.json'), `${JSON.stringify({
    status: strictStatus,
    counts: strictStatus === 'pass'
      ? { high: 0, medium: 0, low: 0 }
      : { high: 1, medium: 0, low: 0 },
    issues: [],
  }, null, 2)}\n`);
}

function pointwiseWeightedResult() {
  return [
    {
      taskId: '1',
      judgeMode: 'pointwise',
      status: 'completed',
      criterionResults: [
        { criterionId: '1.1', status: 'pass' },
        { criterionId: '1.2', status: 'pass' },
      ],
    },
    {
      taskId: '2',
      judgeMode: 'pointwise',
      status: 'completed',
      criterionResults: [{ criterionId: '2.1', status: 'fail' }],
    },
  ];
}

test('custom reference results stay out of the official leaderboard', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-custom-reference-score-'));
  const promptsRoot = join(root, 'prompts');
  const runsRoot = join(root, 'runs');
  try {
    writePromptRepository(promptsRoot);
    writeRun({
      runsRoot, directory: 'custom', id: 'frontenjoyai-002', number: 2, row: 2,
      model: 'candidate', runId: 'custom', strictStatus: 'pass',
      reference: { kind: 'custom', question_id: 'frontenjoyai-002', entry: 'index.html' },
      requirementResults: [{
        taskId: '1', judgeMode: 'pairwise_gsb', status: 'completed', gsb: 'G',
        criterionResults: [{ criterionId: '1.1' }],
      }],
    });
    const { result } = scorePipelineRuns({ promptsRoot, runsRoot, outputRoot: join(root, 'score'), expectedRuns: 1 });
    assert.equal(result.reference_set.kind, 'custom');
    assert.equal(result.run_details[0].audit_passed, true);
    assert.equal(result.run_details[0].identity_valid, true);
    assert.deepEqual(result.leaderboards.official, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('final scorer uses JSON criterion IDs and keeps pairwise GSB task-level', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-json-score-'));
  const promptsRoot = join(root, 'prompts');
  const runsRoot = join(root, 'runs');
  try {
    writeJsonPromptRepository(promptsRoot, [{
      number: 1, id: 'frontenjoyai-001',
      tasks: [
        {
          task_id: '1', task: '功能',
          instructions: '1. 准备数据；2. 这些不是额外判分单元。',
          criteria: [
            { criterion_id: '1.8', text: '1. 上传\n2. 导出；仍是一个 criterion' },
            { criterion_id: '1.2', text: '状态更新' },
          ],
          validation: { description: '验证规程', steps: ['准备页面', '检查输出'] },
        },
        {
          task_id: '2', judge_mode: 'pairwise_gsb', task: '比较视觉',
          criteria: [
            { criterion_id: '2.4', text: '布局清晰' },
            { criterion_id: '2.9', text: '风格一致' },
          ],
        },
      ],
    }]);
    writeRun({
      runsRoot, directory: 'structured', id: 'frontenjoyai-001', number: 1, row: 200,
      model: 'test-model', runId: 'structured', strictStatus: 'pass',
      requirementResults: [
        {
          taskId: '1', judgeMode: 'pointwise', status: 'completed', task_score: 0.5,
          criterionResults: [
            { criterionId: '1.2', status: 'fail' },
            { criterionId: '1.8', status: 'pass' },
          ],
        },
        {
          taskId: '2', judgeMode: 'pairwise_gsb', status: 'completed', gsb: 'S',
          criterionResults: [
            { criterionId: '2.9', reason: '风格相当。' },
            { criterionId: '2.4', reason: '布局相当。' },
          ],
        },
      ],
    });
    const scored = scorePipelineRuns({ promptsRoot, runsRoot, outputRoot: join(root, 'score'), expectedRuns: 1 });
    const run = scored.result.run_details[0];
    assert.equal(run.effective_only, 0.5);
    assert.equal(run.zero_fill, 0.5);
    assert.deepEqual(run.tasks.map((task) => task.effective_only), [0.5, 0.5]);
    assert.equal(run.tasks[1].gsb, 'S');
    assert.equal(scored.result.diagnostics.some((item) => item.severity === 'error'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('final scorer connects pipeline outputs to deterministic leaderboards', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-final-score-'));
  const promptsRoot = join(root, 'prompts');
  const runsRoot = join(root, 'runs');
  const outputRoot = join(root, 'score');
  writePromptRepository(promptsRoot);
  mkdirSync(runsRoot, { recursive: true });

  writeRun({
    runsRoot,
    directory: 'weighted-data',
    id: 'frontenjoyai-001',
    number: 1,
    row: 2,
    model: 'weighted-model',
    runId: 'weighted-r1',
    strictStatus: 'pass',
    requirementResults: pointwiseWeightedResult(),
  });
  writeRun({
    runsRoot,
    directory: 'weighted-web',
    id: 'frontenjoyai-002',
    number: 2,
    row: 4,
    model: 'weighted-model',
    runId: 'weighted-r1',
    strictStatus: 'pass',
    requirementResults: [{
      taskId: '1',
      judgeMode: 'pairwise_gsb',
      status: 'completed',
      gsb: 'S',
      criterionResults: [{ criterionId: '1.1', reason: '双方相当。' }],
    }],
  });
  writeRun({
    runsRoot,
    directory: 'strict-risk',
    id: 'frontenjoyai-001',
    number: 1,
    row: 2,
    model: 'strict-risk-model',
    runId: 'risk-r1',
    strictStatus: 'invalid',
    requirementResults: [
      {
        taskId: '1',
        judgeMode: 'pointwise',
        status: 'completed',
        criterionResults: [
          { criterionId: '1.1', status: 'pass' },
          { criterionId: '1.2', status: 'pass' },
        ],
      },
      {
        taskId: '2',
        judgeMode: 'pointwise',
        status: 'completed',
        criterionResults: [{ criterionId: '2.1', status: 'pass' }],
      },
    ],
  });
  writeRun({
    runsRoot,
    directory: 'needs-review',
    id: 'frontenjoyai-002',
    number: 2,
    row: 4,
    model: 'review-model',
    runId: 'review-r1',
    strictStatus: 'pass',
    requirementResults: [{
      taskId: '1',
      judgeMode: 'pairwise_gsb',
      status: 'needs_review',
      gsb: null,
      criterionResults: [{ criterionId: '1.1', reason: '证据不足。' }],
    }],
  });

  try {
    const scored = scorePipelineRuns({
      promptsRoot,
      runsRoot,
      outputRoot,
      expectedRuns: 3,
    });
    const weightedDataRun = scored.result.run_details.find(
      (run) => run.model === 'weighted-model' && run.question_id === 'frontenjoyai-001',
    );
    assert.equal(weightedDataRun.effective_only, 0.5);
    assert.equal(weightedDataRun.zero_fill, 0.5);
    assert.deepEqual(weightedDataRun.tasks.map((task) => task.effective_only), [1, 0]);

    const weightedWebRun = scored.result.run_details.find(
      (run) => run.model === 'weighted-model' && run.question_id === 'frontenjoyai-002',
    );
    assert.equal(weightedWebRun.tasks[0].gsb, 'S');
    assert.equal(weightedWebRun.tasks[0].effective_only, 0.5);

    const official = scored.result.leaderboards.official.direct;
    const weightedOfficial = official.find((entry) => entry.model === 'weighted-model');
    assert.equal(weightedOfficial.ors, 1 / 6);
    assert.equal(weightedOfficial.ctpr, null);
    assert.equal(weightedOfficial.tsr, null);
    assert.equal(weightedOfficial.rank, null);
    assert.equal(weightedOfficial.run_count, 2);
    assert.equal(weightedOfficial.expected_run_count, 6);
    assert.equal(official.find((entry) => entry.model === 'strict-risk-model').ors, 0);
    assert.deepEqual(scored.result.leaderboards.experimental, {});
    assert.equal(scored.result.diagnostics.some((item) => item.code === 'strict_judge_not_passed'), true);
    const strictRiskRun = scored.result.run_details.find((run) => run.model === 'strict-risk-model');
    assert.deepEqual(strictRiskRun.audit_exclusion_reasons, ['strict_judge_not_passed']);
    const review = official.find((entry) => entry.model === 'review-model');
    assert.equal(review.ors, 0);
    assert.deepEqual(review.coverage.questions, { observed: 1, valid: 1, total: 2, ratio: 0.5, valid_ratio: 0.5 });
    assert.equal(existsSync(scored.jsonPath), true);
    assert.equal(existsSync(scored.markdownPath), true);
    assert.equal(existsSync(scored.manifestPath), true);
    assert.equal(existsSync(scored.result.source.final_score_skill), true);
    assert.equal(scored.result.core_scoring.status, 'not_available');
    assert.equal(weightedDataRun.tsr, null);
    assert.equal(
      scored.result.diagnostics.some((item) => item.code === 'core_policy_not_found'),
      true,
    );
    const markdown = readFileSync(scored.markdownPath, 'utf8');
    assert.match(markdown, /### direct \/ weighted-model/u);
    assert.match(markdown, /\| 题号 \| ID \| ATS \(.*CTPR.*ASR/u);
    assert.doesNotMatch(markdown, /\[object Object\]/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
