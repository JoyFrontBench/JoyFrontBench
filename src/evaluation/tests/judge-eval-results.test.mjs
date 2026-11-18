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
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { writeEvaluationReports } from '../scripts/lib/report-writer.mjs';

import { writePromptRepository as writeJsonPromptRepository } from './helpers/prompt-repository.mjs';

const autoEvalRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function runtimeResult(outputRoot, status = 'passed') {
  mkdirSync(outputRoot, { recursive: true });
  const evidence = join(outputRoot, 'runtime.json');
  writeFileSync(evidence, JSON.stringify({ build: status, browser: status }));
  return { status, reason: 'Fixture build and browser access check.', evidence: [evidence] };
}

function writePromptRepository(root) {
  writeJsonPromptRepository(root, [{
    number: 1,
    id: 'frontenjoyai-001',
    categories: ['数据可视化', '对比'],
    prompt: '实现一个视觉完成度较高的数据页面。\n',
    tasks: [{ task_id: '1', judge_mode: 'pairwise_gsb', task: '视觉层级与完成度', criteria: ['比较两侧主视觉层级、焦点和完成度'] }],
  }]);
}

function writeNumberedPairwisePromptRepository(root) {
  writePromptRepository(root);
  const path = join(root, 'judge/frontenjoyai-001.json');
  const judge = JSON.parse(readFileSync(path, 'utf8'));
  judge.tasks[0].instructions = '以下内容作为辅助判断标准：';
  judge.tasks[0].criteria = [
    { criterion_id: '1.1', text: '导航和内容区结构清晰。' },
    { criterion_id: '1.2', text: '页面信息密度合理。' },
  ];
  writeFileSync(path, JSON.stringify(judge));
}

function runStrictJudge({ promptsRoot, resultsPath, reportRoot }) {
  return spawnSync(process.execPath, [
    join(autoEvalRoot, 'scripts/cli.mjs'), 'judge',
    '--strict',
    `--prompts=${promptsRoot}`,
    `--results=${resultsPath}`,
    `--report-root=${reportRoot}`,
    '--id=frontenjoyai-001',
  ], {
    cwd: autoEvalRoot,
    encoding: 'utf8',
  });
}

for (const { label, frames, duplicate, insufficient, reused } of [
  {
    label: 'duplicate frames under different filenames',
    frames: [['frame-a', 'frame-a'], ['frame-b', 'frame-c']],
    duplicate: true, insufficient: true, reused: false,
  },
  {
    label: 'the same frame set in reversed order',
    frames: [['frame-a', 'frame-b'], ['frame-b', 'frame-a']],
    duplicate: false, insufficient: false, reused: true,
  },
  {
    label: 'distinct frames with equal file sizes',
    frames: [['frame-a', 'frame-b'], ['frame-c', 'frame-d']],
    duplicate: false, insufficient: false, reused: false,
  },
]) {
  test(`Strict Judge compares image bytes for ${label}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'front-judge-images-'));
    try {
      const promptsRoot = join(root, 'prompts');
      const outputRoot = join(root, 'output');
      const task = '验证拖拽响应';
      const criteria = ['拖拽后持续更新', '拖拽后联动变化'];
      writeJsonPromptRepository(promptsRoot, [{
        number: 1, id: 'frontenjoyai-001', categories: ['test'], prompt: 'Build an interactive demo.',
        tasks: [{ task_id: '1', judge_mode: 'pointwise', task, criteria }],
      }]);
      mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
      const evidence = frames.map((contents, criterionIndex) => contents.map((content, frameIndex) => {
        const path = join(outputRoot, 'screenshots', `${criterionIndex}-${frameIndex}.png`);
        writeFileSync(path, content);
        return path;
      }));
      const written = writeEvaluationReports({
        outputRoot,
        results: [{
        buildAndRuntime: runtimeResult(outputRoot),
          id: 'frontenjoyai-001', number: 1, row: 1, profile: 'demo-shape',
          pageUrl: 'http://127.0.0.1:4173/', workspace: '/target',
          requirementResults: [{
            taskId: '1', judgeMode: 'pointwise', task, criteria,
            status: 'completed', task_score: 1, reason: 'Observed response.', evidence: evidence.flat(),
            criterionResults: criteria.map((criterion, index) => ({
              criterionId: `1.${index + 1}`, criterion, status: 'pass',
              reason: 'Observed response.', evidence: evidence[index],
            })),
          }],
        }],
      });
      const run = runStrictJudge({
        promptsRoot, resultsPath: written.resultsPath, reportRoot: join(outputRoot, 'reports'),
      });
      assert.equal(run.status, 0, run.stderr);
      const summary = JSON.parse(readFileSync(join(outputRoot, 'reports/eval-judge-results-strict.json'), 'utf8'));
      const messages = summary.issues.map((issue) => issue.message).join('\n');
      assert.equal(messages.includes('duplicate screenshot content'), duplicate, messages);
      assert.equal(messages.includes('insufficient sequence evidence'), insufficient, messages);
      assert.equal(messages.includes('Identical screenshot content reused'), reused, messages);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const runtimeCase of [
  { name: 'passed with execution logs', status: 'passed', accepted: true },
  { name: 'failed with execution logs', status: 'failed', accepted: true },
  { name: 'missing contract', status: null },
  { name: 'unverified contract', status: 'unverified' },
  { name: 'missing explanation', status: 'passed', emptyReason: true },
  { name: 'missing evidence file', status: 'passed', evidence: 'missing' },
  { name: 'source inspection only', status: 'passed', evidence: 'source' },
  { name: 'screenshot only', status: 'passed', evidence: 'image' },
  { name: 'directory instead of file', status: 'passed', evidence: 'directory' },
]) {
  test(`runtime gate audit handles ${runtimeCase.name} independently of criteria`, (context) => {
    const root = mkdtempSync(join(tmpdir(), 'front-runtime-audit-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const promptsRoot = join(root, 'prompts');
    const outputRoot = join(root, 'output');
    writeJsonPromptRepository(promptsRoot, [{
      number: 1, id: 'frontenjoyai-001',
      tasks: [{ task_id: '1', task: '常量定义', criteria: ['源文件包含设定的常量'] }],
    }]);
    const runtime = runtimeResult(outputRoot, runtimeCase.status);
    if (runtimeCase.emptyReason) runtime.reason = '';
    if (runtimeCase.evidence === 'missing') runtime.evidence = [join(outputRoot, 'missing.json')];
    if (runtimeCase.evidence === 'directory') runtime.evidence = [outputRoot];
    if (runtimeCase.evidence === 'source' || runtimeCase.evidence === 'image') {
      const path = join(outputRoot, runtimeCase.evidence === 'source' ? 'source.js' : 'page.png');
      writeFileSync(path, 'Synthetic evidence fixture.');
      runtime.evidence = [path];
    }
    const criterionEvidence = join(outputRoot, 'criterion.json');
    writeFileSync(criterionEvidence, JSON.stringify({ constant: 42 }));
    const written = writeEvaluationReports({ outputRoot, results: [{
      id: 'frontenjoyai-001', number: 1, row: 1, profile: 'generic',
      ...(runtimeCase.status === null ? {} : { buildAndRuntime: runtime }),
      requirementResults: [{
        taskId: '1', judgeMode: 'pointwise', task: '常量定义',
        criteria: ['源文件包含设定的常量'], criteriaText: '源文件包含设定的常量',
        criterionResults: [{ criterionId: '1.1', criterion: '源文件包含设定的常量', status: 'pass', reason: '独立检查了指定常量的定义和值。', evidence: [criterionEvidence] }],
      }],
    }] });
    const run = runStrictJudge({ promptsRoot, resultsPath: written.resultsPath, reportRoot: join(outputRoot, 'reports') });
    assert.equal(run.status, 0, run.stderr);
    const audit = JSON.parse(readFileSync(join(outputRoot, 'reports/eval-judge-results-strict.json'), 'utf8'));
    assert.equal(audit.status, runtimeCase.accepted ? 'pass' : 'invalid', JSON.stringify(audit.issues));
    assert.ok(audit.issues.every((issue) => issue.scope === 'runtime'), JSON.stringify(audit.issues));
    assert.equal(written.results[0].scoreSummary.zero_fill.score, 1);
  });
}

test('Strict Judge accepts a complete task-level GSB result', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-judge-gsb-'));
  const promptsRoot = join(root, 'prompts');
  const outputRoot = join(root, 'output');
  const tested = join(outputRoot, 'screenshots/tested.png');
  const benchmark = join(outputRoot, 'screenshots/benchmark.png');
  writePromptRepository(promptsRoot);
  mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
  writeFileSync(tested, 'tested-image');
  writeFileSync(benchmark, 'benchmark-image');

  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        buildAndRuntime: runtimeResult(outputRoot),
        id: 'frontenjoyai-001',
        number: 1,
        row: 2,
        profile: 'marketing-toolbox',
        pageUrl: 'http://127.0.0.1:4173/',
        workspace: '/target',
        benchmarkWorkspace: '/benchmark',
        requirementResults: [{
          taskId: '1',
          judgeMode: 'pairwise_gsb',
          task: '视觉层级与完成度',
          criteriaText: '比较两侧主视觉层级、焦点和完成度',
          status: 'completed',
          gsb: 'G',
          task_score: 1,
          reason: ['被测侧主视觉层级更清楚，焦点更集中。'],
          evidence: { tested: [tested], benchmark: [benchmark] },
          comparison_meta: {
            viewport: '1440x900',
            interaction_path: ['打开页面', '等待稳定'],
            sampled_at: '稳定状态',
            high_priority_dimensions: ['视觉层级', '完成度'],
          },
          criterionResults: [{
            criterionId: '1.1',
            criterion: '比较两侧主视觉层级、焦点和完成度',
            reason: '被测侧标题与主体形成更清楚的视觉焦点。',
            evidence: { tested: [tested], benchmark: [benchmark] },
          }],
        }],
      }],
    });
    const run = runStrictJudge({
      promptsRoot,
      resultsPath: written.resultsPath,
      reportRoot: join(outputRoot, 'reports'),
    });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(readFileSync(join(outputRoot, 'reports/eval-judge-results-strict.json'), 'utf8'));
    assert.equal(summary.status, 'pass');
    assert.equal(summary.counts.high, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Strict Judge ignores pairwise introductory prose when counting criteria', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-judge-numbered-gsb-'));
  const promptsRoot = join(root, 'prompts');
  const outputRoot = join(root, 'output');
  const tested = join(outputRoot, 'screenshots/tested.png');
  const benchmark = join(outputRoot, 'screenshots/benchmark.png');
  writeNumberedPairwisePromptRepository(promptsRoot);
  mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
  writeFileSync(tested, 'tested-image');
  writeFileSync(benchmark, 'benchmark-image');

  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        buildAndRuntime: runtimeResult(outputRoot),
        id: 'frontenjoyai-001',
        number: 1,
        row: 2,
        profile: 'marketing-toolbox',
        pageUrl: 'http://127.0.0.1:4173/',
        workspace: '/target',
        benchmarkWorkspace: '/benchmark',
        requirementResults: [{
          taskId: '1',
          judgeMode: 'pairwise_gsb',
          task: '视觉层级与完成度',
          criteriaText: '以下内容作为辅助判断标准：\n1. 导航和内容区结构清晰。\n2. 页面信息密度合理。',
          status: 'completed',
          gsb: 'G',
          task_score: 1,
          reason: ['被测侧结构更清楚且信息密度更合理。'],
          evidence: { tested: [tested], benchmark: [benchmark] },
          comparison_meta: {
            viewport: '1440x900',
            interaction_path: ['打开页面', '等待稳定'],
            sampled_at: '稳定状态',
            high_priority_dimensions: ['结构清晰度', '信息密度'],
          },
          criterionResults: [
            {
              criterionId: '1.1',
              criterion: '导航和内容区结构清晰。',
              reason: '被测侧导航与内容层级更清楚。',
              evidence: { tested: [tested], benchmark: [benchmark] },
            },
            {
              criterionId: '1.2',
              criterion: '页面信息密度合理。',
              reason: '被测侧信息密度更均衡。',
              evidence: { tested: [tested], benchmark: [benchmark] },
            },
          ],
        }],
      }],
    });
    const run = runStrictJudge({
      promptsRoot,
      resultsPath: written.resultsPath,
      reportRoot: join(outputRoot, 'reports'),
    });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(readFileSync(join(outputRoot, 'reports/eval-judge-results-strict.json'), 'utf8'));
    assert.equal(summary.status, 'pass');
    assert.equal(summary.counts.high, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Strict Judge accepts a well-evidenced needs_review without forcing S', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-judge-needs-review-'));
  const promptsRoot = join(root, 'prompts');
  const outputRoot = join(root, 'output');
  const tested = join(outputRoot, 'screenshots/tested.png');
  const benchmark = join(outputRoot, 'screenshots/benchmark.png');
  writePromptRepository(promptsRoot);
  mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
  writeFileSync(tested, 'tested-image');
  writeFileSync(benchmark, 'benchmark-image');

  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        buildAndRuntime: runtimeResult(outputRoot),
        id: 'frontenjoyai-001',
        number: 1,
        row: 2,
        profile: 'marketing-toolbox',
        pageUrl: 'http://127.0.0.1:4173/',
        workspace: '/target',
        benchmarkWorkspace: '/benchmark',
        requirementResults: [{
          taskId: '1',
          judgeMode: 'pairwise_gsb',
          task: '视觉层级与完成度',
          criteriaText: '比较两侧主视觉层级、焦点和完成度',
          status: 'needs_review',
          gsb: null,
          task_score: null,
          reason: ['被测侧层级更强，但 benchmark 的细节完成度更高，当前无法排序。'],
          evidence: { tested: [tested], benchmark: [benchmark] },
          comparison_meta: {
            viewport: '1440x900',
            interaction_path: ['打开页面', '等待稳定'],
            sampled_at: '稳定状态',
            high_priority_dimensions: ['视觉层级', '完成度'],
          },
          criterionResults: [{
            criterionId: '1.1',
            criterion: '比较两侧主视觉层级、焦点和完成度',
            reason: '被测侧焦点更强，benchmark 的局部细节更完整。',
            evidence: { tested: [tested], benchmark: [benchmark] },
          }],
        }],
      }],
    });
    const run = runStrictJudge({
      promptsRoot,
      resultsPath: written.resultsPath,
      reportRoot: join(outputRoot, 'reports'),
    });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(readFileSync(join(outputRoot, 'reports/eval-judge-results-strict.json'), 'utf8'));
    assert.equal(summary.status, 'pass');
    assert.equal(summary.counts.high, 0);
    assert.equal(written.results[0].scoreSummary.effective_only.score, null);
    assert.equal(written.results[0].scoreSummary.zero_fill.score, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Strict Judge rejects the legacy pairwiseVerdict contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-judge-legacy-'));
  const promptsRoot = join(root, 'prompts');
  const outputRoot = join(root, 'output');
  const tested = join(outputRoot, 'screenshots/tested.png');
  writePromptRepository(promptsRoot);
  mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
  writeFileSync(tested, 'tested-image');

  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        buildAndRuntime: runtimeResult(outputRoot),
        id: 'frontenjoyai-001',
        number: 1,
        row: 2,
        profile: 'marketing-toolbox',
        pageUrl: 'http://127.0.0.1:4173/',
        workspace: '/target',
        benchmarkWorkspace: '/benchmark',
        requirementResults: [{
          taskId: '1',
          judgeMode: 'pairwise_gsb',
          task: '视觉层级与完成度',
          criteriaText: '比较两侧主视觉层级、焦点和完成度',
          status: 'pass',
          pairwiseVerdict: 'G',
          reason: '旧格式结果',
          evidence: [tested],
          criterionResults: [{ criterionId: '1.1', status: 'pass', evidence: [tested] }],
        }],
      }],
    });
    const run = runStrictJudge({
      promptsRoot,
      resultsPath: written.resultsPath,
      reportRoot: join(outputRoot, 'reports'),
    });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(readFileSync(join(outputRoot, 'reports/eval-judge-results-strict.json'), 'utf8'));
    assert.equal(summary.status, 'invalid');
    assert.ok(summary.counts.high > 0);
    assert.match(summary.issues.map((item) => item.message).join('\n'), /pairwiseVerdict|tested.*benchmark|comparison_meta/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
