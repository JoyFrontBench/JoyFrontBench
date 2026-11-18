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
import { basename, join } from 'node:path';

import {
  validateEvaluationArtifacts,
  writeEvaluationReports,
} from '../scripts/lib/report-writer.mjs';

test('reports use structured criteria without parsing numbering or validation prose', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'front-auto-eval-structured-report-'));
  const criterion = '1. 点击鼓面\n2. 检查状态；3. 这些仍是一个 criterion';
  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        id: 'frontenjoyai-029', number: 29, row: 29,
        requirementResults: [{
          taskId: '1', judgeMode: 'pointwise', task: '鼓面交互',
          criteriaText: `${criterion}\n**验证规程**：\n1. 打开页面\n2. 记录状态`,
          criterionResults: [{ criterionId: '1.8', criterion, status: 'fail', reason: '状态没有更新。', evidence: [] }],
        }],
      }],
    });
    const requirement = written.results[0].requirementResults[0];
    assert.deepEqual(requirement.criteria, [criterion]);
    assert.equal(requirement.criterionResults.length, 1);
    assert.equal(requirement.criterionResults[0].criterionId, '1.8');
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('writeEvaluationReports renders the report Skill output contract', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'front-auto-eval-report-'));
  const screenshot = join(outputRoot, 'screenshots/state.png');
  const benchmarkScreenshot = join(outputRoot, 'screenshots/benchmark.png');
  const data = join(outputRoot, 'data/state.json');
  mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
  mkdirSync(join(outputRoot, 'data'), { recursive: true });
  writeFileSync(screenshot, 'not-a-real-png');
  writeFileSync(benchmarkScreenshot, 'not-a-real-png');
  writeFileSync(data, `${JSON.stringify({ visible: true, count: 3 }, null, 2)}\n`);

  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        id: 'frontenjoyai-029',
        number: 29,
        row: 30,
        profile: 'octopus-drum-svg',
        pageUrl: 'http://127.0.0.1:4173/',
        workspace: '/target',
        requirementResults: [
          {
            taskId: '1',
            judgeMode: 'pointwise',
            task: '鼓面交互',
            criteriaText: '1. 点击鼓面产生反馈；2. 状态数据正确',
            originalCriteria: '1. 点击鼓面产生反馈；2. 状态数据正确',
            criteriaSource: 'criteria',
            criteria: ['点击鼓面产生反馈', '状态数据正确'],
            criterionResults: [
              {
                criterionId: '1.1',
                criterion: '点击鼓面产生反馈',
                status: 'pass',
                reason: '点击后鼓面形变并出现高亮。',
                evidence: [screenshot, data],
              },
              {
                criterionId: '1.2',
                criterion: '状态数据正确',
                status: 'fail',
                reason: '计数没有递增。',
                evidence: [data],
              },
            ],
          },
          {
            taskId: '2',
            judgeMode: 'pairwise_gsb',
            task: '视觉对比',
            criteriaText: '与 benchmark 比较整体视觉完成度',
            originalCriteria: '与 benchmark 比较整体视觉完成度',
            criteriaSource: 'criteria',
            status: 'completed',
            gsb: 'G',
            reason: ['被测页面层次更清楚。'],
            evidence: {
              tested: [screenshot],
              benchmark: [benchmarkScreenshot],
            },
            comparison_meta: {
              viewport: '1440x900',
              interaction_path: ['打开页面', '等待稳定'],
              sampled_at: '稳定状态',
              high_priority_dimensions: ['视觉层级'],
            },
            criterionResults: [{
              criterionId: '2.1',
              criterion: '与 benchmark 比较整体视觉完成度',
              reason: '被测侧主体层级更清楚，benchmark 的焦点较弱。',
              evidence: {
                tested: [screenshot],
                benchmark: [benchmarkScreenshot],
              },
            }],
          },
        ],
      }],
    });

    const result = written.results[0];
    assert.equal(basename(result.reportPath), '30-frontenjoyai-029-report.md');
    assert.equal(basename(result.htmlReportPath), '30-frontenjoyai-029-report.html');
    assert.deepEqual(result.pointwiseSummary, {
      pass: 1,
      fail: 1,
      blocked: 0,
      error: 0,
      total: 2,
    });
    assert.deepEqual(result.pairwiseSummary, [{
      taskId: '2',
      status: 'completed',
      gsb: 'G',
      task_score: 1,
    }]);
    assert.equal(result.status, 'completed');
    assert.equal(result.scoreSummary.effective_only.score, 0.75);
    assert.equal(result.scoreSummary.stage, 'pre_audit');
    assert.equal(result.buildAndRuntime.status, 'unverified');
    assert.equal(result.scoreSummary.zero_fill.score, 0.75);
    assert.equal(Object.hasOwn(result.requirementResults[0], 'judge'), false);
    assert.equal(Object.hasOwn(result.requirementResults[0], 'subResults'), false);
    assert.equal(Object.hasOwn(result.requirementResults[0].criterionResults[0], 'taskId'), false);
    assert.equal(Object.hasOwn(result.requirementResults[0].criterionResults[0], 'task'), false);

    const markdown = readFileSync(result.reportPath, 'utf8');
    const html = readFileSync(result.htmlReportPath, 'utf8');
    assert.match(markdown, /## 要求列表/u);
    assert.match(markdown, /## Criterion 评定/u);
    assert.match(markdown, /## Pairwise GSB task级结论/u);
    assert.match(markdown, /有效 Task 均分：75\.0%/u);
    assert.match(markdown, /Task 均分（异常计零）：75\.0%/u);
    assert.match(markdown, /## 截图全集/u);
    assert.match(markdown, /文件：state\.json/u);
    assert.match(html, /rowspan="2"/u);
    assert.match(html, /<details open>/u);
    assert.match(html, /<h2>截图全集<\/h2>/u);
    assert.match(html, /有效 Task 均分：75\.0%/u);
    assert.match(html, /Task 均分（异常计零）：75\.0%/u);

    const summaryMarkdown = readFileSync(written.summaryMarkdownPath, 'utf8');
    const summaryHtml = readFileSync(written.summaryHtmlPath, 'utf8');
    assert.match(summaryMarkdown, /\| 有效 Task 均分 \| Task 均分（异常计零） \|/u);
    assert.match(summaryHtml, /<th>有效 Task 均分<\/th><th>Task 均分（异常计零）<\/th>/u);

    assert.deepEqual(
      validateEvaluationArtifacts({ outputRoot, results: written.results }),
      { ok: true, missing: [], evidenceMissing: [] },
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('writeEvaluationReports keeps needs_review unscored in effective_only', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'front-auto-eval-needs-review-'));
  const tested = join(outputRoot, 'screenshots/tested.png');
  const benchmark = join(outputRoot, 'screenshots/benchmark.png');
  mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
  writeFileSync(tested, 'tested');
  writeFileSync(benchmark, 'benchmark');

  try {
    const written = writeEvaluationReports({
      outputRoot,
      results: [{
        id: 'frontenjoyai-029',
        number: 29,
        row: 30,
        profile: 'octopus-drum-svg',
        workspace: '/target',
        benchmarkWorkspace: '/benchmark',
        requirementResults: [{
          taskId: '1',
          judgeMode: 'pairwise_gsb',
          task: '视觉对比',
          criteriaText: '比较视觉完成度',
          originalCriteria: '比较视觉完成度',
          criteriaSource: 'criteria',
          status: 'needs_review',
          gsb: null,
          task_score: null,
          reason: ['两侧分别在层级与细节上占优，当前证据无法确定优先级。'],
          evidence: { tested: [tested], benchmark: [benchmark] },
          comparison_meta: {
            viewport: '1440x900',
            interaction_path: ['打开页面'],
            sampled_at: '稳定状态',
            high_priority_dimensions: ['视觉层级', '细节完成度'],
          },
          criterionResults: [{
            criterionId: '1.1',
            criterion: '比较视觉完成度',
            reason: '被测侧层级更强，benchmark 细节更完整。',
            evidence: { tested: [tested], benchmark: [benchmark] },
          }],
        }],
      }],
    });

    const result = written.results[0];
    assert.equal(result.status, 'needs_review');
    assert.equal(result.pairwiseSummary[0].gsb, null);
    assert.equal(result.pairwiseSummary[0].task_score, null);
    assert.deepEqual(result.scoreSummary.effective_only, {
      score: null,
      valid: 0,
      total: 1,
      coverage: 0,
    });
    assert.equal(result.scoreSummary.zero_fill.score, 0);
    assert.equal(result.scoreSummary.zero_fill.exceptions, 1);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
