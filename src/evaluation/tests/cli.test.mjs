import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseCommandArgs } from '../scripts/lib/config.mjs';
import { runJudge } from '../scripts/lib/judge.mjs';
import { writePromptRepository } from './helpers/prompt-repository.mjs';

const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));

test('all CLI commands and compatibility aliases provide side-effect-free help', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-cli-help-'));
  try {
    for (const command of ['eval', 'eval:pipeline', 'eval:batch', 'judge', 'judge:strict', 'score:final', 'references:verify', 'verify:references', 'check', 'test', 'codex']) {
      const result = spawnSync(process.execPath, [cli, command, '--help'], {
        cwd: root,
        env: { AUTO_EVAL_ENV_FILE: '', HOME: root },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      assert.match(result.stdout, /Usage:/u);
    }
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('argument parsing shares last-value precedence and evaluator defaults', () => {
  const environment = { EVAL_MODEL: 'configured-judge', CODEX_REASONING_EFFORT: 'xhigh' };
  for (const command of ['eval:pipeline', 'eval:batch']) {
    const options = parseCommandArgs(command, ['--model=first', '--candidate-model', 'last', '--max-remediation=1'], environment);
    assert.equal(options.modelLabel, 'last');
    assert.equal(options.codexModel, 'configured-judge');
    assert.equal(options.reasoning, 'xhigh');
    assert.equal(options.maxRemediation, 1);
  }
  for (const command of ['eval:pipeline', 'eval:batch', 'score:final', 'judge']) {
    assert.equal(parseCommandArgs(command, ['--prompts=first', '--prompt-repository', 'last'], {}).promptsRoot, 'last');
    assert.throws(() => parseCommandArgs(command, ['--prompts'], {}), /requires a value/u);
    assert.throws(() => parseCommandArgs(command, ['--prompts', '--helpful'], {}), /requires a value/u);
    assert.throws(() => parseCommandArgs(command, ['--unknown=1'], {}), /Unknown option/u);
  }
});

test('batch arguments combine selection and validate isolated concurrency controls', () => {
  const options = parseCommandArgs('eval:batch', ['--ids=first,second', '--ids=second,third', '--jobs=2', '--concurrency=4', '--executor=docker'], {});
  assert.deepEqual(options.ids, ['first', 'second', 'third']);
  assert.equal(options.jobs, 4);
  assert.equal(options.executor, 'docker');
  for (const value of ['0', '33', '1.5', '']) {
    assert.throws(() => parseCommandArgs('eval:batch', [`--jobs=${value}`], {}), /--jobs/u);
  }
  assert.equal(parseCommandArgs('eval:batch', [], {}).expectedRuns, parseCommandArgs('score:final', [], {}).expectedRuns);
  assert.throws(() => parseCommandArgs('eval:batch', ['--executor=unknown'], {}), /--executor/u);
  assert.throws(() => parseCommandArgs('eval:pipeline', ['--provider=unknown'], {}), /--provider/u);
  assert.throws(() => parseCommandArgs('eval:pipeline', ['--dry-run=false'], {}), /does not take a value/u);
});

test('judge options retain strict mode, repeated filters, and report defaults', () => {
  const options = parseCommandArgs('judge', ['--strict', '--id=first', '--id=second', '--row=1', '--row=2', '--report-root=/reports'], {});
  assert.deepEqual([...options.ids], ['first', 'second']);
  assert.deepEqual([...options.rows], [1, 2]);
  assert.equal(options.resultsPath, '/reports/eval-summary-results.json');
  assert.equal(options.strict, true);
  assert.throws(() => parseCommandArgs('judge', ['--row=wrong'], {}), /--row/u);
});

test('judge is callable repeatedly without shared CLI state or output paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-judge-module-'));
  try {
    const promptsRoot = join(root, 'prompts');
    writePromptRepository(promptsRoot, [{
      number: 1, id: 'frontenjoyai-001', categories: ['网页'], prompt: '实现页面。',
      tasks: [{ task_id: '1', task: '页面功能', criteria: ['页面可用'] }],
    }]);
    const resultsPath = join(root, 'results.json');
    writeFileSync(resultsPath, '[]');
    const first = runJudge({ promptsRoot, resultsPath, reportRoot: join(root, 'first'), strict: true });
    const second = runJudge({ promptsRoot, resultsPath, reportRoot: join(root, 'second') });
    assert.equal(first.status, 'invalid');
    assert.equal(second.status, 'invalid');
    assert.notEqual(first.jsonPath, second.jsonPath);
    assert.ok(existsSync(first.jsonPath));
    assert.ok(existsSync(second.jsonPath));
    assert.match(first.jsonPath, /eval-judge-results-strict\.json$/u);
    assert.match(second.jsonPath, /eval-judge-results\.json$/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI rejects unknown commands and unisolated local parallelism', () => {
  const unknown = spawnSync(process.execPath, [cli, 'unknown-command'], { encoding: 'utf8' });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/u);
  const parallel = spawnSync(process.execPath, [cli, 'eval:batch', '--jobs=2'], { encoding: 'utf8' });
  assert.equal(parallel.status, 1);
  assert.match(parallel.stderr, /isolated Docker workers/u);
});
