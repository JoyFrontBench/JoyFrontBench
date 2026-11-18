import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJudgeJson, parsePromptGroups } from '../scripts/lib/tasks.mjs';
import { loadCoreScoringPolicy } from '../scripts/lib/core-scoring.mjs';
import { dataRoot as repositoryRoot } from '../scripts/lib/config.mjs';
import { writePromptRepository } from './helpers/prompt-repository.mjs';

const testRoot = dirname(fileURLToPath(import.meta.url));

function judgeDocument() {
  return {
    schema_version: 1,
    question_id: 'frontenjoyai-001',
    tasks: [{
      task_id: '1',
      judge_mode: 'pointwise',
      task: '上传文件',
      instructions: '按实际数据检查，不增加判分单元。',
      criteria: [
        { criterion_id: '1.8', text: '可以上传 CSV\n1. 保留这个编号在同一个 criterion 内' },
        { criterion_id: '1.2', text: '可以导出 JSON' },
      ],
      validation: { description: '验证规程（validation protocol）', steps: ['准备文件', '上传后导出'] },
    }],
  };
}

test('parseJudgeJson preserves explicit IDs, modes, criteria and ordered validation steps', () => {
  const document = judgeDocument();
  document.tasks.push({
    task_id: '2.1',
    judge_mode: 'pairwise_gsb',
    task: '比较视觉',
    criteria: [{ criterion_id: '2.1.4', text: '布局清晰' }],
  });
  const items = parseJudgeJson(JSON.stringify(document), 'judge.json', 'frontenjoyai-001');
  assert.deepEqual(items.map((item) => item.taskId), ['1', '2.1']);
  assert.deepEqual(items.map((item) => item.judgeMode), ['pointwise', 'pairwise_gsb']);
  assert.deepEqual(items[0].criterionIds, ['1.8', '1.2']);
  assert.deepEqual(items[0].criteria, document.tasks[0].criteria.map((item) => item.text));
  assert.deepEqual(items[0].validation.steps, ['准备文件', '上传后导出']);
  assert.match(items[0].criteriaText, /上传后导出/u);
  assert.match(items[0].criteriaText, /不增加判分单元/u);
  assert.equal(items[1].validation, null);
});

test('parseJudgeJson rejects malformed JSON and mismatched question identity', () => {
  assert.throws(() => parseJudgeJson('{', 'invalid.json'), /Invalid JSON in invalid\.json/u);
  assert.throws(() => parseJudgeJson('null'), /Expected an object/u);
  assert.throws(() => parseJudgeJson('[]'), /Expected an object/u);
  assert.throws(() => parseJudgeJson(JSON.stringify(judgeDocument()), 'judge.json', 'other'), /question_id mismatch/u);
});

for (const [label, mutate, expected] of [
  ['schema reference type', (data) => { data.$schema = 123; }, /\$schema/u],
  ['schema version', (data) => { data.schema_version = 2; }, /schema_version/u],
  ['question ID', (data) => { delete data.question_id; }, /question_id/u],
  ['empty tasks', (data) => { data.tasks = []; }, /tasks/u],
  ['duplicate task IDs', (data) => { data.tasks.push(structuredClone(data.tasks[0])); }, /Duplicate task_id/u],
  ['missing task ID', (data) => { delete data.tasks[0].task_id; }, /task_id/u],
  ['numeric task ID', (data) => { data.tasks[0].task_id = 1; }, /task_id/u],
  ['missing mode', (data) => { delete data.tasks[0].judge_mode; }, /judge_mode/u],
  ['legacy mode', (data) => { data.tasks[0].judge_mode = 'gsb'; }, /judge_mode/u],
  ['empty task text', (data) => { data.tasks[0].task = ' '; }, /task for/u],
  ['Markdown criteria blob', (data) => { data.tasks[0].criteria = '1. 上传'; }, /criteria/u],
  ['empty criteria', (data) => { data.tasks[0].criteria = []; }, /criteria/u],
  ['duplicate criterion IDs', (data) => { data.tasks[0].criteria[1].criterion_id = '1.8'; }, /Duplicate criterion_id/u],
  ['missing criterion ID', (data) => { delete data.tasks[0].criteria[0].criterion_id; }, /criterion_id/u],
  ['wrong parent ID', (data) => { data.tasks[0].criteria[0].criterion_id = '2.1'; }, /must belong/u],
  ['empty criterion text', (data) => { data.tasks[0].criteria[0].text = ''; }, /criterion text/u],
  ['invalid validation steps', (data) => { data.tasks[0].validation.steps = '打开页面'; }, /validation steps/u],
  ['empty validation step', (data) => { data.tasks[0].validation.steps = ['']; }, /validation step/u],
  ['missing validation description', (data) => { delete data.tasks[0].validation.description; }, /validation description/u],
  ['legacy field', (data) => { data.tasks[0].task_judge = '上传'; }, /Unknown field/u],
]) {
  test(`parseJudgeJson rejects ${label}`, () => {
    const document = judgeDocument();
    mutate(document);
    assert.throws(() => parseJudgeJson(JSON.stringify(document)), expected);
  });
}

function fixture(directory) {
  return writePromptRepository(directory, [{
    number: 1,
    id: 'frontenjoyai-001',
    categories: ['数据可视化', '曲线'],
    prompt: '一级分类：数据可视化\n二级分类：曲线\n\n实现流量曲线。',
    tasks: judgeDocument().tasks,
  }]);
}

test('parsePromptGroups reads current public prompts, rubrics and question metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'front-auto-eval-prompts-'));
  try {
    fixture(directory);
    const parsed = parsePromptGroups(directory);
    const group = parsed.groups[0];
    assert.equal(group.row, 1);
    assert.equal(group.number, 1);
    assert.equal(group.taskKey, '001');
    assert.equal(group.id, 'frontenjoyai-001');
    assert.equal(group.category, '数据可视化 / 曲线');
    assert.match(group.prompt, /实现流量曲线/u);
    assert.deepEqual(group.requirements[0].criterionIds, ['1.8', '1.2']);
    assert.equal(group.requirements[0].criteriaSource, 'criteria');
    assert.equal(group.requirements[0].originalCriteria, group.requirements[0].criteriaText);
    assert.equal(parsed.selectionAudit[0].selected, false);
    assert.equal(parsed.source.datasetPath, join(directory, 'dataset.json'));
    writeFileSync(group.source.taskPath, '实现更新后的流量曲线。');
    assert.equal(parsePromptGroups(directory).groups[0].prompt, '实现更新后的流量曲线。');
    const judge = judgeDocument();
    judge.tasks[0].validation.steps.push('验证保存后的数据');
    writeFileSync(group.source.judgePath, JSON.stringify(judge));
    assert.deepEqual(parsePromptGroups(directory).groups[0].requirements[0].validation.steps, judge.tasks[0].validation.steps);
    const dataset = parsed.source.dataset;
    dataset.questions[0].categories.push('测试');
    writeFileSync(parsed.source.datasetPath, JSON.stringify(dataset));
    assert.equal(parsePromptGroups(directory).groups[0].category, '数据可视化 / 曲线 / 测试');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [label, mutate, expected] of [
  ['schema version', (data) => { data.schema_version = 2; }, /schema_version/u],
  ['empty questions', (data) => { data.questions = []; }, /questions/u],
  ['invalid number', (data) => { data.questions[0].number = 0; }, /question number/u],
  ['empty ID', (data) => { data.questions[0].id = ''; }, /question id/u],
  ['empty categories', (data) => { data.questions[0].categories = []; }, /categories/u],
  ['duplicate numbers', (data) => { data.questions.push({ ...data.questions[0], id: 'other' }); }, /Duplicate question number/u],
  ['duplicate IDs', (data) => { data.questions.push({ ...data.questions[0], number: 2 }); }, /Duplicate question id/u],
  ['mismatched Judge', (data) => { data.questions[0].id = 'other'; }, /question_id mismatch/u],
  ['path traversal', (data) => { data.questions[0].prompt_file = '../outside.md'; }, /must stay inside/u],
  ['absolute path', (data) => { data.questions[0].judge_file = '/tmp/judge.json'; }, /must stay inside/u],
  ['missing prompt path', (data) => { delete data.questions[0].prompt_file; }, /prompt.*path/u],
  ['missing Judge file', (data) => { data.questions[0].judge_file = 'judge/missing.json'; }, /Missing judge/u],
  ['Markdown Judge file', (data) => { data.questions[0].judge_file = 'judge/frontenjoyai-001.md'; }, /must be a \.json file/u],
  ['internal Excel metadata', (data) => { data.questions[0].excelRow = 2; }, /Unknown field excelRow/u],
]) {
  test(`parsePromptGroups rejects ${label}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'front-auto-eval-invalid-'));
    try {
      const dataset = fixture(directory);
      mutate(dataset);
      writeFileSync(join(directory, 'dataset.json'), JSON.stringify(dataset));
      assert.throws(() => parsePromptGroups(directory), expected);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('release JSON preserves all 30 prompts, 219 tasks, 782 criteria and validation protocols', () => {
  const baseline = JSON.parse(readFileSync(join(testRoot, 'fixtures/release-rubric-baseline.json'), 'utf8'));
  const repository = parsePromptGroups(repositoryRoot);
  assert.equal(repository.groups.length, 30);
  assert.equal(existsSync(join(repositoryRoot, 'manifest.json')), false);
  assert.equal(readdirSync(join(repositoryRoot, 'judge')).filter((name) => name.endsWith('.json')).length, 30);
  assert.equal(readdirSync(join(repositoryRoot, 'judge')).some((name) => name.endsWith('.md')), false);
  assert.equal(repository.groups.flatMap((group) => group.requirements).length, 219);
  assert.equal(repository.groups.flatMap((group) => group.requirements.flatMap((item) => item.criteria)).length, 782);
  assert.equal(repository.groups.flatMap((group) => group.requirements.filter((item) => item.validation)).length, 165);
  for (const [index, group] of repository.groups.entries()) {
    const expected = baseline.questions[index];
    assert.equal(group.id, expected.id);
    assert.equal(group.number, expected.number);
    assert.equal(group.category, expected.categories.join(' / '));
    assert.equal(group.prompt, readFileSync(group.source.taskPath, 'utf8').trim(), `prompt ${group.id}`);
    assert.equal(group.requirements.length, expected.tasks);
    assert.equal(group.requirements.flatMap((item) => item.criteria).length, expected.criteria);
    assert.equal(group.requirements.filter((item) => item.validation).length, expected.validation_protocols);
    const semantics = group.requirements.map((item) => ({
      task_id: item.taskId,
      judge_mode: item.judgeMode,
      task: item.task,
      instructions: item.instructions,
      criteria: item.criteria.map((text, criterionIndex) => ({ criterion_id: item.criterionIds[criterionIndex], text })),
      validation: item.validation,
    }));
    const document = JSON.parse(readFileSync(group.source.judgePath, 'utf8'));
    assert.deepEqual(semantics, document.tasks.map((task) => ({
      task_id: task.task_id,
      judge_mode: task.judge_mode,
      task: task.task,
      instructions: task.instructions || '',
      criteria: task.criteria,
      validation: task.validation || null,
    })), `rubric ${group.id}`);
  }
});

test('dataset loader rejects missing indexes, malformed indexes and symlink escapes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'front-auto-eval-paths-'));
  const root = join(directory, 'prompts');
  try {
    assert.throws(() => parsePromptGroups(directory), /Missing dataset index/u);
    const dataset = fixture(root);
    writeFileSync(join(root, 'dataset.json'), '{');
    assert.throws(() => parsePromptGroups(root), /Invalid JSON/u);
    writeFileSync(join(directory, 'outside.json'), JSON.stringify(judgeDocument()));
    symlinkSync(join(directory, 'outside.json'), join(root, 'judge/outside.json'));
    dataset.questions[0].judge_file = 'judge/outside.json';
    writeFileSync(join(root, 'dataset.json'), JSON.stringify(dataset));
    assert.throws(() => parsePromptGroups(root), /must stay inside/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release core scoring policy still matches the migrated dataset', () => {
  const repository = parsePromptGroups(repositoryRoot);
  const policy = loadCoreScoringPolicy({ promptsRoot: repositoryRoot, repository, diagnostics: [] });
  assert.equal(policy.status, 'ready');
  assert.deepEqual(policy.summary, {
    questions: 30, tasks: 219, core_tasks: 112, criteria: 782, gating: 210, should: 488, quality: 84,
  });
});
