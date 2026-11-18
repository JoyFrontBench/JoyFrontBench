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
import { fileURLToPath } from 'node:url';

import { mergeAuthoritativeResult, resolveBenchmarkWorkspace, resolveTopicSkillName, runPipeline, writePipelineContext } from '../scripts/lib/pipeline.mjs';
import { parseCommandArgs } from '../scripts/lib/config.mjs';

import { writePromptRepository as writeJsonPromptRepository } from './helpers/prompt-repository.mjs';
import { parseJudgeJson } from '../scripts/lib/tasks.mjs';

const evaluationRoot = fileURLToPath(new URL('../', import.meta.url));

function writePromptRepository(root, { id = 'frontenjoyai-029', judgeMode = 'pointwise' } = {}) {
  writeJsonPromptRepository(root, [{
    number: 29,
    id,
    categories: ['图形', 'SVG'],
    prompt: '实现一个可交互的章鱼爵士鼓页面。\n',
    tasks: [{ task_id: '1', judge_mode: judgeMode, task: '鼓面交互', criteria: ['点击鼓面产生反馈', '页面状态数据正确'] }],
  }]);
}

test('pipeline command accepts the formal pipeline options', () => {
  const options = parseCommandArgs('eval:pipeline', [
    '--prompts=/prompts',
    '--workspace', '/workspace',
    '--id=frontenjoyai-029',
    '--model=candidate',
    '--reasoning=xhigh',
    '--max-remediation=2',
    '--dry-run',
  ]);
  assert.equal(options.promptsRoot, '/prompts');
  assert.equal(options.workspace, '/workspace');
  assert.equal(options.modelLabel, 'candidate');
  assert.equal(options.reasoning, 'xhigh');
  assert.equal(options.maxRemediation, 2);
  assert.equal(options.dryRun, true);
});

test('topic profile aliases resolve to existing Skills', () => {
  const aliases = {
    'demo-particles': 'canvas-3d',
    'demo-shape': 'canvas-3d',
    'iphone-site': 'iphone-product-site',
    'siamese-nyc-svg': 'siamese-city-svg',
    'travel-app': 'mobile-travel-app',
    'octopus-drum-svg': 'octopus-drum-svg',
  };
  for (const [profile, directory] of Object.entries(aliases)) {
    assert.equal(resolveTopicSkillName(profile), directory);
    assert.equal(
      existsSync(join(evaluationRoot, 'skills/page-evaluation/topics', directory, 'SKILL.md')),
      true,
      profile,
    );
  }
});

test('adjacent reference applications require an explicit benchmark selection', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-benchmark-'));
  const workspace = join(root, 'comparison/candidate/frontenjoyai-029');
  const benchmark = join(root, 'comparison/benchmark/frontenjoyai-029');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(benchmark, { recursive: true });
  writeFileSync(join(workspace, 'index.html'), '<!doctype html>');
  writeFileSync(join(benchmark, 'index.html'), '<!doctype html>');

  try {
    assert.throws(() => resolveBenchmarkWorkspace({
      workspace, questionId: 'frontenjoyai-029', benchmark: '', required: true,
    }), /benchmark_unresolved/u);
    const resolved = resolveBenchmarkWorkspace({
      workspace,
      questionId: 'frontenjoyai-029',
      benchmark,
      required: true,
    });
    assert.equal(resolved.workspacePath, benchmark);
    assert.equal(resolved.entry, 'index.html');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mergeAuthoritativeResult keeps the official criteria and fills missing leaves', () => {
  const context = {
    question: { id: 'frontenjoyai-029', row: 30, number: 29, profile: 'octopus-drum-svg' },
    workspace: { path: '/target' },
    benchmark: null,
    runIdentity: { harness: 'direct', model: 'candidate', question: 29, runId: 'test' },
    requirements: [{
      taskId: '1',
      judgeMode: 'pointwise',
      task: '鼓面交互',
      criteriaText: '1. 点击鼓面产生反馈；2. 页面状态数据正确',
      originalCriteria: '1. 点击鼓面产生反馈；2. 页面状态数据正确',
      criteriaSource: 'criteria',
      criteria: ['点击鼓面产生反馈', '页面状态数据正确'],
      criterionIds: ['1.1', '1.2'],
    }],
  };
  const merged = mergeAuthoritativeResult({
    pageUrl: 'http://127.0.0.1:4173/',
    requirementResults: [{
      taskId: '1',
      criterionResults: [{
        criterionId: '1.1',
        status: 'pass',
        reason: '观察到反馈。',
        evidence: ['/output/screenshots/feedback.png'],
      }],
    }],
  }, context);
  assert.equal(merged.requirementResults[0].criterionResults.length, 2);
  assert.equal(merged.url, 'http://127.0.0.1:4173/');
  assert.equal(merged.requirementResults[0].criterionResults[0].criterion, '点击鼓面产生反馈');
  assert.equal(merged.requirementResults[0].criterionResults[1].status, 'fail');
  assert.match(merged.requirementResults[0].criterionResults[1].reason, /未返回 criterion 1\.2/u);
  assert.equal(Object.hasOwn(merged.requirementResults[0], 'judge'), false);
  assert.equal(Object.hasOwn(merged.requirementResults[0], 'subResults'), false);
  assert.equal(Object.hasOwn(merged.requirementResults[0].criterionResults[0], 'taskId'), false);
});

test('mergeAuthoritativeResult uses explicit JSON IDs without splitting criterion text', () => {
  const requirements = parseJudgeJson(JSON.stringify({
    schema_version: 1,
    question_id: 'frontenjoyai-001',
    tasks: [{
      task_id: '1', judge_mode: 'pointwise', task: '功能检查',
      criteria: [
        { criterion_id: '1.8', text: '1. 上传\n2. 导出；仍是同一个判分单元' },
        { criterion_id: '1.2', text: '状态正确' },
      ],
      validation: { description: '验证规程', steps: ['准备', '检查'] },
    }],
  }));
  const context = {
    question: { id: 'frontenjoyai-001', number: 1, row: 1 },
    workspace: { path: '/target' },
    requirements,
  };
  const merged = mergeAuthoritativeResult({
    requirementResults: [{
      taskId: '1',
      criterionResults: [
        { criterionId: '1.2', status: 'fail', reason: '状态未更新。', evidence: [] },
        { criterionId: '1.8', status: 'pass', reason: '上传导出结果正确。', evidence: ['data/result.json'] },
      ],
    }],
  }, context);
  const result = merged.requirementResults[0];
  assert.deepEqual(result.criterionResults.map((item) => item.criterionId), ['1.8', '1.2']);
  assert.deepEqual(result.criteria, requirements[0].criteria);
  assert.deepEqual(result.validation.steps, ['准备', '检查']);
  assert.equal(result.task_score, 0.5);
  assert.deepEqual(result.contractIssues, []);
});

test('mergeAuthoritativeResult applies the task-level GSB contract', () => {
  const context = {
    question: { id: 'frontenjoyai-029', row: 30, number: 29, profile: 'octopus-drum-svg' },
    workspace: { path: '/target' },
    benchmark: { path: '/benchmark', target: { entryPath: '/benchmark/index.html' } },
    runIdentity: { harness: 'direct', model: 'candidate', question: 29, runId: 'test' },
    requirements: [{
      taskId: '2',
      judgeMode: 'pairwise_gsb',
      task: '视觉完成度',
      criteriaText: '1. 比较视觉层级；2. 比较风格一致性',
      originalCriteria: '1. 比较视觉层级；2. 比较风格一致性',
      criteriaSource: 'criteria',
      criteria: ['比较视觉层级', '比较风格一致性'],
      criterionIds: ['2.1', '2.2'],
    }],
  };
  const merged = mergeAuthoritativeResult({
    requirementResults: [{
      taskId: '2',
      status: 'completed',
      gsb: 'S',
      reason: ['两侧高优视觉维度整体相当。'],
      evidence: {
        tested: ['/output/screenshots/tested.png'],
        benchmark: ['/output/screenshots/benchmark.png'],
      },
      comparison_meta: {
        viewport: '1440x900',
        interaction_path: ['打开页面', '等待稳定'],
        sampled_at: '稳定状态',
        high_priority_dimensions: ['视觉层级', '风格一致性'],
      },
      criterionResults: [
        {
          criterionId: '2.1',
          reason: '两侧主视觉层级接近。',
          evidence: {
            tested: ['/output/screenshots/tested.png'],
            benchmark: ['/output/screenshots/benchmark.png'],
          },
        },
        {
          criterionId: '2.2',
          reason: '两侧风格一致性接近。',
          evidence: {
            tested: ['/output/screenshots/tested.png'],
            benchmark: ['/output/screenshots/benchmark.png'],
          },
        },
      ],
    }],
  }, context);

  const result = merged.requirementResults[0];
  assert.equal(result.status, 'completed');
  assert.equal(result.gsb, 'S');
  assert.equal(result.task_score, 0.5);
  assert.deepEqual(result.contractIssues, []);
  assert.equal(Object.hasOwn(result.criterionResults[0], 'status'), false);
  assert.equal(Object.hasOwn(result.criterionResults[0], 'taskId'), false);
  assert.deepEqual(result.evidence, {
    tested: ['/output/screenshots/tested.png'],
    benchmark: ['/output/screenshots/benchmark.png'],
  });
});

test('mergeAuthoritativeResult rejects legacy pairwise result fields', () => {
  const context = {
    question: { id: 'frontenjoyai-029', row: 30, number: 29, profile: 'octopus-drum-svg' },
    workspace: { path: '/target' },
    benchmark: { path: '/benchmark', target: { entryPath: '/benchmark/index.html' } },
    runIdentity: { harness: 'direct', model: 'candidate', question: 29, runId: 'test' },
    requirements: [{
      taskId: '2',
      judgeMode: 'pairwise_gsb',
      task: '视觉完成度',
      criteriaText: '比较视觉完成度',
      originalCriteria: '比较视觉完成度',
      criteriaSource: 'criteria',
      criteria: ['比较视觉完成度'],
      criterionIds: ['2.1'],
    }],
  };
  const merged = mergeAuthoritativeResult({
    requirementResults: [{
      taskId: '2',
      status: 'pass',
      pairwiseVerdict: 'G',
      reason: '旧格式结果',
      evidence: ['/output/screenshots/tested.png'],
      subResults: [{ taskId: '2.1', status: 'pass' }],
    }],
  }, context);

  const result = merged.requirementResults[0];
  assert.equal(result.status, 'needs_review');
  assert.equal(result.gsb, null);
  assert.equal(result.task_score, null);
  assert.equal(Object.hasOwn(result, 'pairwiseVerdict'), false);
  assert.equal(Object.hasOwn(result, 'subResults'), false);
  assert.match(result.contractIssues.join('\n'), /pairwiseVerdict 已废弃/u);
  assert.match(result.contractIssues.join('\n'), /旧字段 subResults/u);
  assert.match(result.contractIssues.join('\n'), /status 非法或缺失/u);
});

test('runPipeline dry-run writes a fresh context and prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'front-auto-eval-pipeline-'));
  const promptsRoot = join(root, 'prompts');
  const workspace = join(root, 'workspace');
  const outputRoot = join(root, 'output');
  writePromptRepository(promptsRoot);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'index.html'), '<!doctype html>');

  try {
    const options = parseCommandArgs('eval:pipeline', [
      `--prompts=${promptsRoot}`,
      `--workspace=${workspace}`,
      '--id=frontenjoyai-029',
      `--output-root=${outputRoot}`,
      '--model=candidate',
      '--dry-run',
    ]);
    const result = await runPipeline(options);
    assert.equal(result.status, 'prepared');
    const context = JSON.parse(readFileSync(join(outputRoot, 'pipeline-context.json'), 'utf8'));
    const prompt = readFileSync(join(outputRoot, 'logs/initial-prompt.md'), 'utf8');
    assert.equal(context.question.id, 'frontenjoyai-029');
    assert.deepEqual(context.skills, {
      pipeline: join(evaluationRoot, 'skills/pipeline/SKILL.md'),
      common: join(evaluationRoot, 'skills/page-evaluation/SKILL.md'),
      topic: join(evaluationRoot, 'skills/page-evaluation/topics/octopus-drum-svg/SKILL.md'),
      report: join(evaluationRoot, 'skills/report-generation/SKILL.md'),
      judge: join(evaluationRoot, 'skills/judge/SKILL.md'),
    });
    for (const skillPath of Object.values(context.skills)) {
      assert.equal(existsSync(skillPath), true, skillPath);
    }
    assert.match(prompt, /不要自行生成最终报告/u);
    assert.match(prompt, /buildAndRuntime/u);
    assert.match(prompt, /构建、启动和浏览器访问/u);
    assert.match(prompt, /严禁删除、清空或重命名/u);
    rmSync(join(outputRoot, 'pipeline-context.json'));
    writePipelineContext(context);
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputRoot, 'pipeline-context.json'), 'utf8')),
      context,
    );
    await assert.rejects(() => runPipeline({ ...options }), /Output directory is not empty/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
