import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { parsePromptGroups } from '../scripts/lib/tasks.mjs';
import { loadCoreScoringPolicy } from '../scripts/lib/core-scoring.mjs';
import { dataRoot as promptsRoot } from '../scripts/lib/config.mjs';

function readMetadata(filename) {
  return JSON.parse(readFileSync(join(promptsRoot, filename), 'utf8'));
}

function assertKeys(value, expected, context) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), context);
}

test('release data root only includes public benchmark metadata and directories', () => {
  const entries = readdirSync(promptsRoot, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(filenames, [
    'capability-dimensions.json',
    'core-criteria-policy.json',
    'dataset.json',
  ]);
  assert.deepEqual(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(), ['judge', 'references', 'tasks']);
});

test('released dataset and rubrics need no external schema files', () => {
  const dataset = readMetadata('dataset.json');
  assertKeys(dataset, ['schema_version', 'questions'], 'dataset');
  assert.equal(dataset.schema_version, 1);
  for (const question of dataset.questions) {
    const judge = readMetadata(question.judge_file);
    assertKeys(judge, ['schema_version', 'question_id', 'tasks'], question.id);
    assert.equal(judge.schema_version, 1);
    assert.equal(judge.question_id, question.id);
  }
});

test('release metadata preserves the complete effective scoring policy', () => {
  const repository = parsePromptGroups(promptsRoot);
  const diagnostics = [];
  const policy = loadCoreScoringPolicy({ promptsRoot, repository, diagnostics });
  assert.equal(policy.status, 'ready');
  assert.deepEqual(diagnostics, []);
  const document = readMetadata('core-criteria-policy.json');
  assert.equal(policy.version, document.version);
  assert.equal(policy.kind, document.kind);
  assert.equal(policy.review_required, false);
  assert.deepEqual(policy.summary, {
    questions: 30, tasks: 219, core_tasks: 112, criteria: 782, gating: 210, should: 488, quality: 84,
  });
  assert.deepEqual([...policy.questionsById.values()], document.questions.map((question) => ({
    question_no: Number(question.question_no),
    question_id: question.question_id,
    core_task_ids: question.core_task_ids,
    tasks: question.tasks.map(({ task, ...fields }) => fields),
  })));
});

test('published core policy excludes generation and review artifacts', () => {
  const document = readMetadata('core-criteria-policy.json');
  assertKeys(document, [
    'version', 'kind', 'review_required', 'definitions', 'questions',
  ], 'policy');
  assertKeys(document.definitions, [
    'gating', 'should', 'quality', 'core_task_derivation', 'pairwise_note',
  ], 'policy definitions');
  for (const question of document.questions) {
    assertKeys(question, [
      'question_no', 'question_id', 'core_task_ids', 'tasks',
    ], question.question_id);
    for (const task of question.tasks) {
      assertKeys(task, [
        'task_id', 'judge_mode', 'task', 'derived_level', 'is_core_task',
        'core_gate_scope', 'criteria',
      ], `${question.question_id}/${task.task_id}`);
      for (const criterion of task.criteria) {
        assertKeys(criterion, [
          'criterion_id', 'criterion', 'level',
        ], `${question.question_id}/${criterion.criterion_id}`);
      }
    }
  }
});

test('capability metadata retains eight dimensions and every task label', () => {
  const document = readMetadata('capability-dimensions.json');
  const repository = parsePromptGroups(promptsRoot);
  assertKeys(document, ['version', 'method', 'items'], 'capability metadata');
  assert.equal(document.version, 2);
  assertKeys(document.method, [
    'taxonomy', 'dimensions', 'labeling', 'labeling_unit', 'decision_rule',
    'manual_review_rule',
  ], 'capability method');
  assert.equal(document.method.labeling, 'single-label');
  assert.doesNotMatch(document.method.taxonomy, /\bv\d+\b/iu);
  assert.equal(document.method.labeling_unit, 'task');
  assert.equal(document.method.dimensions.length, 8);
  for (const dimension of document.method.dimensions) {
    assertKeys(dimension, ['name', 'description'], dimension.name);
  }
  const allowedDimensions = new Set(document.method.dimensions.map((dimension) => dimension.name));
  assert.equal(allowedDimensions.size, 8);
  allowedDimensions.add('待人工判定');
  for (const item of document.items) {
    assertKeys(item, [
      'question_id', 'task_id', 'capability_dimension',
    ], `${item.question_id}/${item.task_id}`);
    assert.equal(typeof item.question_id, 'string');
    assert.equal(typeof item.task_id, 'string');
    assert.ok(allowedDimensions.has(item.capability_dimension), item.capability_dimension);
  }
  const expectedTasks = repository.groups.flatMap((group) => group.requirements.map(
    (requirement) => `${group.id}/${requirement.taskId}`,
  ));
  const labeledTasks = document.items.map((item) => `${item.question_id}/${item.task_id}`);
  assert.equal(labeledTasks.length, 219);
  assert.equal(new Set(labeledTasks).size, labeledTasks.length);
  assert.deepEqual(labeledTasks, expectedTasks);
  assert.deepEqual(document.method.dimensions.map((dimension) => dimension.name), [
    '组件完备', '表征保真', '视觉品质', '交互响应', '计算渲染', '规则仿真', '状态管理', '数据交换',
  ]);
  assert.deepEqual(Object.fromEntries(document.method.dimensions.map((dimension) => [
    dimension.name, document.items.filter((item) => item.capability_dimension === dimension.name).length,
  ])), {
    组件完备: 30, 表征保真: 12, 视觉品质: 26, 交互响应: 11,
    计算渲染: 31, 规则仿真: 67, 状态管理: 34, 数据交换: 8,
  });
});

test('evaluation guides do not depend on versioned reference implementation names', () => {
  const guides = [
    'capability-annotation/SKILL.md',
    'final-score/SKILL.md',
    'page-evaluation/SKILL.md',
    ...[
      'data-news-dashboard', 'json-transform-workbench', 'lattice-migration-3d',
      'mobile-finance-dashboard', 'rps-training-dashboard', 'svg-poster-generator',
      'waste-sorting-game', 'wildlife-alert-review',
    ].map((topic) => `page-evaluation/topics/${topic}/SKILL.md`),
  ];
  for (const guide of guides) {
    const content = readFileSync(new URL(`../skills/${guide}`, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /(?:\b|_)v\d+\b/iu, guide);
  }
});
