import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  annotationLimits,
  buildQuestionInput,
  buildQuestionResult,
  parseArgs,
  redactSensitiveText,
  resolveModelConfig,
  selectQuestionGroups,
  validateModelAnnotations,
  validateSourceQuestions,
} from './annotate-core-criteria.mjs';

const groups = [
  {
    number: 1,
    id: 'frontenjoyai-001',
    category: '数据可视化',
    prompt: '实现曲线编辑器。',
    requirements: [
      {
        taskId: '3',
        judgeMode: 'pointwise',
        task: '拖动曲线',
        criteriaText: '1.两类曲线均可拖动\n2.拖动后双向联动',
        criteria: ['两类曲线均可拖动', '拖动后双向联动'],
        criterionIds: ['3.1', '3.2'],
      },
      {
        taskId: '5',
        judgeMode: 'pairwise_gsb',
        task: '整体美观',
        criteriaText: '1.视觉清晰\n2.风格统一',
        criteria: ['视觉清晰', '风格统一'],
        criterionIds: ['5.1', '5.2'],
      },
    ],
  },
  {
    number: 2,
    id: 'frontenjoyai-002',
    category: '网页',
    prompt: '实现后台页面。',
    requirements: [],
  },
];

function candidateDocument() {
  const annotations = groups[0].requirements.flatMap((requirement) => requirement.criterionIds.map((criterionId) => ({
    criterionId, level: 'should', confidence: 'high', reason: 'Required behavior.',
  })));
  return { questions: [buildQuestionResult(groups[0], annotations)] };
}

test('candidate reuse compares original prompt and rubric text directly', () => {
  const document = candidateDocument();
  assert.equal(document.questions[0].prompt, groups[0].prompt);
  assert.doesNotThrow(() => validateSourceQuestions(document, groups));
});

for (const [label, mutate] of [
  ['prompt', (question) => { question.prompt = 'Different task.'; }],
  ['question number', (question) => { question.question_no = '002'; }],
  ['task ID', (question) => { question.tasks[0].task_id = 'other'; }],
  ['mode', (question) => { question.tasks[0].judge_mode = 'pairwise_gsb'; }],
  ['task text', (question) => { question.tasks[0].task = 'Different criterion.'; }],
  ['criterion ID', (question) => { question.tasks[0].criteria[0].criterion_id = '3.9'; }],
  ['criterion text', (question) => { question.tasks[0].criteria[0].criterion = 'Different text.'; }],
  ['missing criterion', (question) => { question.tasks[0].criteria.pop(); }],
]) {
  test(`candidate reuse rejects changed ${label}`, () => {
    const document = candidateDocument();
    mutate(document.questions[0]);
    assert.throws(() => validateSourceQuestions(document, groups), /changed since annotations/u);
  });
}

test('candidate reuse rejects duplicate and unknown questions', () => {
  const document = candidateDocument();
  document.questions.push(structuredClone(document.questions[0]));
  assert.throws(() => validateSourceQuestions(document, groups), /Question changed/u);
  document.questions.pop();
  document.questions[0].question_id = 'unknown';
  assert.throws(() => validateSourceQuestions(document, groups), /Question changed/u);
});

test('parseArgs requires explicit question selection', () => {
  assert.throws(() => parseArgs([]), /--questions is required/u);
  const options = parseArgs([
    '--questions=001-002',
    '--api-base=https://api.example.com/v1',
    '--api-key-env=OPENAI_API_KEY',
    '--model-id=custom-evaluator',
    '--concurrency=3',
    '--review-from=first-pass.json',
    '--max-gating-ratio=0.35',
    '--max-core-task-ratio=0.5',
    '--dry-run',
  ]);
  assert.equal(options.questions, '001-002');
  assert.equal(options.apiBase, 'https://api.example.com/v1');
  assert.equal(options.apiKeyEnv, 'OPENAI_API_KEY');
  assert.equal(options.modelId, 'custom-evaluator');
  assert.equal(options.concurrency, 3);
  assert.match(options.reviewFrom, /first-pass\.json$/u);
  assert.equal(options.maxGatingRatio, 0.35);
  assert.equal(options.maxCoreTaskRatio, 0.5);
  assert.equal(options.dryRun, true);
});

test('candidate annotations default to private evaluation output', () => {
  const options = parseArgs(['--questions=001', '--dry-run']);
  assert.equal(
    options.outputPath,
    fileURLToPath(new URL('../../eval-output/core-criteria-candidates.json', import.meta.url)),
  );
});

test('annotations use an upstream model ID and shared API configuration', () => {
  const model = resolveModelConfig('', {
    EVAL_MODEL: 'custom-evaluator',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'https://api.example.com/v1',
  });
  assert.equal(model.model, 'custom-evaluator');
  assert.equal(model.apiUrl, 'https://api.example.com/v1/responses');
  assert.equal(model.apiKeyEnv, 'OPENAI_API_KEY');
  assert.equal(model.apiKey, 'test-key');
  assert.throws(() => resolveModelConfig('custom-evaluator', {}), /OPENAI_API_KEY/u);
});

test('selectQuestionGroups accepts numbers, ranges, and ids without duplicates', () => {
  assert.deepEqual(
    selectQuestionGroups(groups, '001-002,frontenjoyai-001').map((group) => group.id),
    ['frontenjoyai-001', 'frontenjoyai-002'],
  );
  assert.throws(() => selectQuestionGroups(groups, '003'), /Unknown questions/u);
});

test('validation and result building preserve authoritative criteria', () => {
  const limits = annotationLimits(groups[0]);
  const input = buildQuestionInput(groups[0], null, limits);
  assert.deepEqual(
    input.tasks.flatMap((task) => task.criteria.map((criterion) => criterion.criterion_id)),
    ['3.1', '3.2', '5.1', '5.2'],
  );
  assert.deepEqual(input.selection_limits, {
    max_gating_criteria: 2,
    max_core_tasks: 1,
    core_task_rule: 'A pointwise task is core when at least one criterion is mandatory (stored as gating); pairwise_gsb tasks do not enter core acceptance.',
  });

  const annotations = validateModelAnnotations(groups[0], {
    question_id: 'frontenjoyai-001',
    annotations: [
      { criterion_id: '5.2', level: 'quality', confidence: 'high', reason: '属于一致性质量。' },
      { criterion_id: '3.2', level: 'gating', confidence: 'high', reason: '决定核心联动。' },
      { criterion_id: '5.1', level: 'quality', confidence: 'high', reason: '属于视觉质量。' },
      { criterion_id: '3.1', level: 'gating', confidence: 'high', reason: '决定基本可用性。' },
    ],
  });
  assert.deepEqual(annotations.map((item) => item.criterionId), ['3.1', '3.2', '5.1', '5.2']);

  const result = buildQuestionResult(groups[0], annotations);
  assert.deepEqual(result.core_task_ids, ['3']);
  assert.equal(result.tasks[0].core_gate_scope, 'criteria');
  assert.equal(result.tasks[1].core_gate_scope, 'task');
  assert.deepEqual(result.counts, {
    tasks: 2,
    core_tasks: 1,
    criteria: 4,
    gating: 2,
    should: 0,
    quality: 2,
  });
});

test('strict limits reject an over-broad gating set', () => {
  assert.throws(
    () => validateModelAnnotations(groups[0], {
      question_id: 'frontenjoyai-001',
      annotations: [
        { criterion_id: '3.1', level: 'gating', confidence: 'high', reason: '核心。' },
        { criterion_id: '3.2', level: 'gating', confidence: 'high', reason: '核心。' },
        { criterion_id: '5.1', level: 'should', confidence: 'high', reason: '重要。' },
        { criterion_id: '5.2', level: 'quality', confidence: 'high', reason: '质量。' },
      ],
    }, { maxGatingCriteria: 1, maxCoreTasks: 1 }),
    /Too many gating criteria/u,
  );
});

test('pairwise criteria cannot enter the functional core gate', () => {
  assert.throws(
    () => validateModelAnnotations(groups[0], {
      question_id: 'frontenjoyai-001',
      annotations: [
        { criterion_id: '3.1', level: 'gating', confidence: 'high', reason: '核心。' },
        { criterion_id: '3.2', level: 'should', confidence: 'high', reason: '重要。' },
        { criterion_id: '5.1', level: 'gating', confidence: 'high', reason: '视觉身份。' },
        { criterion_id: '5.2', level: 'quality', confidence: 'high', reason: '质量。' },
      ],
    }),
    /pairwise_gsb criterion cannot be gating: 5\.1/u,
  );
});

test('validation rejects missing or duplicated criteria', () => {
  assert.throws(
    () => validateModelAnnotations(groups[0], {
      question_id: 'frontenjoyai-001',
      annotations: [
        { criterion_id: '3.1', level: 'gating', confidence: 'high', reason: '核心。' },
      ],
    }),
    /Missing criterion_id values/u,
  );
  assert.throws(
    () => validateModelAnnotations(groups[0], {
      question_id: 'frontenjoyai-001',
      annotations: [
        { criterion_id: '3.1', level: 'gating', confidence: 'high', reason: '核心。' },
        { criterion_id: '3.1', level: 'gating', confidence: 'high', reason: '重复。' },
      ],
    }),
    /Duplicate criterion_id/u,
  );
});

test('API errors redact configured and token-shaped secrets', () => {
  const tokenShapedSecret = ['pk', 'example-secret-123456'].join('-');
  assert.equal(
    redactSensitiveText(`bad ${tokenShapedSecret} and custom-secret`, ['custom-secret']),
    'bad [REDACTED] and [REDACTED]',
  );
});
