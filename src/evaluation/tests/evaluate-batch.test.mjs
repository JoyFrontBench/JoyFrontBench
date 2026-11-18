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

import { runEvaluationBatch } from '../scripts/lib/batch.mjs';
import { parseCommandArgs } from '../scripts/lib/config.mjs';
import { resolveWorkspaceTarget } from '../scripts/lib/run-workspaces.mjs';

import { writePromptRepository as writeJsonPromptRepository } from './helpers/prompt-repository.mjs';
import { CAPABILITY_DIMENSION_NAMES } from '../scripts/lib/capability-scoring.mjs';

function writePromptRepository(root) {
  writeJsonPromptRepository(root, [[1, 'frontenjoyai-001', '数据'], [2, 'frontenjoyai-002', '网页']].map(([number, id, category]) => ({
    number,
    id,
    categories: [category],
    prompt: `实现 ${id}。\n`,
    tasks: [{ task_id: '1', task: '功能', criteria: ['页面可用'] }],
  })));
}

function batchFixture(context, extraArgs = []) {
  const root = mkdtempSync(join(tmpdir(), 'front-batch-scheduler-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const promptsRoot = join(root, 'prompts');
  const workspaceRoot = join(root, 'workspaces');
  writePromptRepository(promptsRoot);
  for (const id of ['frontenjoyai-001', 'frontenjoyai-002']) {
    mkdirSync(join(workspaceRoot, id), { recursive: true });
    writeFileSync(join(workspaceRoot, id, 'index.html'), '<!doctype html>');
  }
  return parseCommandArgs('eval:batch', [
    `--prompts=${promptsRoot}`, `--workspace-root=${workspaceRoot}`,
    `--output-root=${join(root, 'output')}`, '--repetitions=3', '--jobs=2', ...extraArgs,
  ], {});
}

function scoreResult() {
  return { result: { source: { discovered_run_count: 6 }, diagnostics: [] } };
}

function writeAcceptedRun(options) {
  mkdirSync(join(options.outputRoot, 'reports'), { recursive: true });
  writeFileSync(join(options.outputRoot, 'reports/eval-summary-results.json'), JSON.stringify([{
    id: options.id,
    number: options.number,
    runIdentity: { harness: options.harness, model: options.modelLabel, run_id: options.runId },
    requirementResults: [{
      taskId: '1', judgeMode: 'pointwise', status: 'completed',
      criterionResults: [{ criterionId: '1.1', status: 'pass' }],
    }],
  }]));
  writeFileSync(join(options.outputRoot, 'reports/eval-judge-results-strict.json'), JSON.stringify({ status: 'pass', issues: [] }));
  return { status: 'ready', outputRoot: options.outputRoot };
}

for (const layout of ['questions', 'run-tree']) {
  test(`unlaunchable ${layout} workspaces remain evaluable without blocking healthy runs`, async (context) => {
    const options = batchFixture(context, [
      '--repetitions=1', '--expected-runs=1', '--jobs=1',
      '--harness=opencode', '--model=candidate', `--workspace-layout=${layout}`,
    ]);
    const workspaces = ['frontenjoyai-001', 'frontenjoyai-002'].map((id) => {
      const questionRoot = join(options.workspaceRoot, id);
      rmSync(join(questionRoot, 'index.html'));
      const workspace = layout === 'run-tree' ? join(questionRoot, 'run-1/workspace') : questionRoot;
      mkdirSync(workspace, { recursive: true });
      return workspace;
    });
    writeFileSync(join(workspaces[0], 'index.html'), '<!doctype html>');
    const calls = [];
    const result = await runEvaluationBatch(options, {
      pipelineRunner: async (entry) => {
        calls.push(entry.id);
        assert.equal(existsSync(join(options.outputRoot, 'batch-state.json')), true);
        if (entry.id === 'frontenjoyai-002') {
          assert.equal(entry.workspace, workspaces[1]);
          assert.equal(resolveWorkspaceTarget(entry.workspace).mode, 'unlaunchable');
          return { status: 'invalid' };
        }
        return writeAcceptedRun(entry);
      },
    });
    assert.deepEqual(calls, ['frontenjoyai-001', 'frontenjoyai-002']);
    assert.equal(result.counts.ready, 1);
    assert.equal(result.counts.invalid, 1);
    assert.equal(result.status, 'completed-with-followup');
    assert.equal(result.final_score.status, 'completed');
    const scored = JSON.parse(readFileSync(result.final_score.json_path, 'utf8'));
    assert.equal(scored.leaderboards.official.opencode[0].ors, 0.5);
    assert.equal(scored.run_details.length, 2);
  });
}

for (const failure of ['ambiguous', 'missing']) {
  test(`${failure} run workspaces retain failed slots while healthy runs finish`, async (context) => {
    const options = batchFixture(context, [
      '--repetitions=1', '--expected-runs=1', '--jobs=1',
      '--harness=opencode', '--model=candidate', '--workspace-layout=run-tree',
    ]);
    for (const id of ['frontenjoyai-001', 'frontenjoyai-002']) {
      const questionRoot = join(options.workspaceRoot, id);
      rmSync(join(questionRoot, 'index.html'));
      const runRoot = join(questionRoot, 'run-1');
      mkdirSync(runRoot, { recursive: true });
      writeFileSync(join(runRoot, 'metadata.json'), JSON.stringify({ status: 'failed' }));
      const workspace = join(runRoot, 'workspace');
      if (id === 'frontenjoyai-001') {
        mkdirSync(workspace);
        writeFileSync(join(workspace, 'index.html'), '<!doctype html>');
      } else if (failure === 'ambiguous') {
        for (const name of ['project-a', 'project-b']) {
          mkdirSync(join(workspace, name), { recursive: true });
          writeFileSync(join(workspace, name, 'index.html'), '<!doctype html>');
        }
      }
    }
    const calls = [];
    const result = await runEvaluationBatch(options, {
      pipelineRunner: async (entry) => {
        calls.push(entry.id);
        return writeAcceptedRun(entry);
      },
    });
    assert.deepEqual(calls, ['frontenjoyai-001']);
    assert.equal(result.counts.ready, 1);
    assert.equal(result.counts.error, 1);
    assert.equal(result.status, 'completed-with-errors');
    assert.equal(result.final_score.status, 'completed');
    assert.match(result.entries[1].error, failure === 'ambiguous' ? /Multiple runnable projects/u : /ENOENT/u);
    const scored = JSON.parse(readFileSync(result.final_score.json_path, 'utf8'));
    assert.equal(scored.leaderboards.official.opencode[0].ors, 0.5);
    assert.equal(scored.run_details.length, 2);
  });
}

test('shared scheduler bounds concurrency and scores only after every worker finishes', async (context) => {
  const options = batchFixture(context);
  let active = 0;
  let peak = 0;
  let finished = 0;
  let scored = 0;
  const outputs = new Set();
  const result = await runEvaluationBatch(options, {
    pipelineRunner: async (entry) => {
      active += 1;
      peak = Math.max(peak, active);
      outputs.add(entry.outputRoot);
      await new Promise((resolveWait) => setTimeout(resolveWait, 15));
      active -= 1;
      finished += 1;
      return { status: 'ready' };
    },
    finalScorer: async () => {
      assert.equal(finished, 6);
      assert.equal(active, 0);
      scored += 1;
      return scoreResult();
    },
  });
  assert.equal(peak, 2);
  assert.equal(outputs.size, 6);
  assert.equal(scored, 1);
  assert.equal(result.counts.ready, 6);
  assert.equal(result.status, 'completed');
});

test('fail-fast drains active workers but skips queued tasks', async (context) => {
  const options = batchFixture(context, ['--fail-fast']);
  let started = 0;
  const result = await runEvaluationBatch(options, {
    pipelineRunner: async () => {
      started += 1;
      if (started === 1) throw new Error('worker failed');
      await new Promise((resolveWait) => setTimeout(resolveWait, 15));
      return { status: 'ready' };
    },
    finalScorer: scoreResult,
  });
  assert.equal(started, 2);
  assert.equal(result.counts.error, 1);
  assert.equal(result.counts.ready, 1);
  assert.equal(result.counts.skipped, 4);
  assert.equal(result.status, 'completed-with-errors');
});

test('cancelled batches skip final scoring and preserve final task states', async (context) => {
  const options = batchFixture(context);
  const controller = new AbortController();
  const result = await runEvaluationBatch(options, {
    signal: controller.signal,
    pipelineRunner: async () => {
      controller.abort();
      throw new Error('cancelled');
    },
    finalScorer: () => { throw new Error('scoring must not run'); },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.counts.cancelled, 1);
  assert.equal(result.counts.skipped, 5);
  assert.equal(result.final_score, null);
  assert.equal(JSON.parse(readFileSync(result.statePath)).status, 'cancelled');
});

test('scoring failures and dry-run worker failures remain batch failures', async (context) => {
  const options = batchFixture(context);
  const result = await runEvaluationBatch(options, {
    pipelineRunner: async () => ({ status: 'ready' }),
    finalScorer: () => { throw new Error('scoring failed'); },
  });
  assert.equal(result.status, 'completed-with-errors');
  assert.equal(result.final_score.status, 'error');
  options.outputRoot += '-dry';
  options.dryRun = true;
  const prepared = await runEvaluationBatch(options, {
    pipelineRunner: async () => { throw new Error('preparation failed'); },
  });
  assert.equal(prepared.status, 'completed-with-errors');
  assert.equal(prepared.counts.error, 6);
});

test('batch command accepts selection and final-score controls', () => {
  const options = parseCommandArgs('eval:batch', [
    '--prompts=/prompts',
    '--workspace-root=/workspaces',
    '--output-root=/output',
    '--ids=frontenjoyai-001,frontenjoyai-002',
    '--ids', 'frontenjoyai-005',
    '--repetitions=2',
    '--expected-runs=3',
    '--core-policy=/policy.json',
    '--workspace-layout=questions',
    '--model=candidate',
    '--reasoning=xhigh',
    '--fail-fast',
  ]);
  assert.deepEqual(options.ids, ['frontenjoyai-001', 'frontenjoyai-002', 'frontenjoyai-005']);
  assert.equal(options.repetitions, 2);
  assert.equal(options.expectedRuns, 3);
  assert.equal(options.corePolicyPath, '/policy.json');
  assert.equal(options.workspaceLayout, 'questions');
  assert.equal(options.modelLabel, 'candidate');
  assert.equal(options.reasoning, 'xhigh');
  assert.equal(options.failFast, true);
});

test('batch runner discovers numbered run trees and nested projects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-run-tree-'));
  const promptsRoot = join(root, 'prompts');
  const workspaceRoot = join(root, 'openhands', 'candidate-model');
  const nestedProject = join(workspaceRoot, '001', 'source-run-a', 'workspace', 'project');
  const outputRoot = join(root, 'output');
  writePromptRepository(promptsRoot);
  mkdirSync(join(nestedProject, 'dist'), { recursive: true });
  writeFileSync(join(nestedProject, 'dist/index.html'), '<!doctype html>');
  const pipelineCalls = [];

  try {
    const result = await runEvaluationBatch({
      promptsRoot,
      workspaceRoot,
      benchmarkRoot: '',
      workspaceLayout: 'auto',
      outputRoot,
      ids: ['frontenjoyai-001'],
      repetitions: 1,
      expectedRuns: 3,
      harness: '',
      modelLabel: '',
      runId: '',
      codexModel: 'GPT-5.5',
      provider: 'api',
      reasoning: 'high',
      codexBin: 'codex',
      maxRemediation: 3,
      failFast: false,
      dryRun: true,
    }, {
      pipelineRunner: async (options) => {
        pipelineCalls.push(options);
        return { status: 'prepared', outputRoot: options.outputRoot };
      },
    });

    assert.equal(result.status, 'prepared');
    assert.equal(pipelineCalls.length, 1);
    assert.equal(pipelineCalls[0].workspace, nestedProject);
    assert.equal(pipelineCalls[0].runId, 'source-run-a');
    assert.equal(pipelineCalls[0].harness, 'openhands');
    assert.equal(pipelineCalls[0].modelLabel, 'candidate-model');
    assert.equal(result.entries[0].workspace_layout, 'run-tree');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch runner evaluates selected runs before invoking final scoring once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-batch-'));
  const promptsRoot = join(root, 'prompts');
  const workspaceRoot = join(root, 'candidate');
  const outputRoot = join(root, 'output');
  writePromptRepository(promptsRoot);
  mkdirSync(join(workspaceRoot, 'frontenjoyai-001'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'frontenjoyai-002'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'frontenjoyai-001/index.html'), '<!doctype html>');
  writeFileSync(join(workspaceRoot, 'frontenjoyai-002/index.html'), '<!doctype html>');
  const pipelineCalls = [];
  const scoreCalls = [];

  try {
    const result = await runEvaluationBatch({
      promptsRoot,
      workspaceRoot,
      benchmarkRoot: '',
      outputRoot,
      ids: ['frontenjoyai-002'],
      repetitions: 2,
      expectedRuns: 3,
      corePolicyPath: '/policy.json',
      harness: 'custom-harness',
      modelLabel: 'candidate',
      runId: 'candidate-batch',
      codexModel: 'GPT-5.5',
      provider: 'api',
      reasoning: 'high',
      codexBin: 'codex',
      maxRemediation: 3,
      failFast: false,
      dryRun: false,
    }, {
      pipelineRunner: async (options) => {
        pipelineCalls.push(options);
        return { status: 'ready', outputRoot: options.outputRoot };
      },
      finalScorer: (options) => {
        scoreCalls.push(options);
        return {
          result: { source: { discovered_run_count: 2 }, diagnostics: [] },
          jsonPath: join(options.outputRoot, 'final-score.json'),
          markdownPath: join(options.outputRoot, 'final-score.md'),
          manifestPath: join(options.outputRoot, 'scoring-input-manifest.json'),
        };
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(pipelineCalls.length, 2);
    assert.deepEqual(pipelineCalls.map((call) => call.runId), [
      'candidate-batch-r01',
      'candidate-batch-r02',
    ]);
    assert.deepEqual(pipelineCalls.map((call) => call.id), ['frontenjoyai-002', 'frontenjoyai-002']);
    assert.equal(scoreCalls.length, 1);
    assert.equal(scoreCalls[0].expectedRuns, 3);
    assert.equal(scoreCalls[0].corePolicyPath, '/policy.json');
    assert.equal(scoreCalls[0].runsRoot, join(outputRoot, 'runs'));
    assert.equal(result.final_score.status, 'completed');
    assert.equal(result.final_score.primary_metric, null);
    assert.equal(result.final_score.core_metrics_available, false);
    assert.equal(result.final_score.capability_dimensions_available, false);
    assert.equal(existsSync(result.statePath), true);
    assert.equal(existsSync(result.summaryPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch scoring automatically emits official capability scores without extra configuration', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'front-batch-capability-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const promptsRoot = join(root, 'prompts');
  const workspaceRoot = join(root, 'candidate');
  writePromptRepository(promptsRoot);
  mkdirSync(join(workspaceRoot, 'frontenjoyai-001'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'frontenjoyai-001/index.html'), '<!doctype html>');
  writeFileSync(join(promptsRoot, 'capability-dimensions.json'), JSON.stringify({
    version: 2,
    method: {
      labeling: 'single-label',
      labeling_unit: 'task',
      dimensions: CAPABILITY_DIMENSION_NAMES.map((name) => ({ name, description: name })),
    },
    items: ['frontenjoyai-001', 'frontenjoyai-002'].map((questionId) => ({
      question_id: questionId, task_id: '1', capability_dimension: '组件完备',
    })),
  }));
  const result = await runEvaluationBatch({
    promptsRoot,
    workspaceRoot,
    outputRoot: join(root, 'output'),
    ids: ['frontenjoyai-001'],
    repetitions: 1,
    expectedRuns: 3,
    harness: 'openhands',
    modelLabel: 'candidate',
    runId: 'capability-batch',
    dryRun: false,
  }, {
    pipelineRunner: async (options) => writeAcceptedRun(options),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.final_score.capability_dimensions_available, true);
  const scored = JSON.parse(readFileSync(result.final_score.json_path, 'utf8'));
  assert.equal(scored.capability_dimensions.scope, 'official');
  const dimensions = scored.capability_dimensions.dimension_scores.openhands[0].dimension_scores;
  assert.equal(dimensions.length, 8);
  assert.equal(dimensions[0].score, 1 / 6);
  assert.equal(dimensions[0].total_task_count, 2);
  assert.equal(dimensions[0].expected_task_run_count, 6);
  assert.match(readFileSync(result.final_score.markdown_path, 'utf8'), /组件完备 \| 16\.67/u);
});
