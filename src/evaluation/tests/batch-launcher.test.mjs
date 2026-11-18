import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dockerEnvironment } from './helpers/docker-stub.mjs';

const launcher = fileURLToPath(new URL('../scripts/docker-run.sh', import.meta.url));

function fixture(context, environment = {}) {
  const root = mkdtempSync(join(tmpdir(), 'front-batch-launcher-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, 'runs/opencode/candidate');
  for (const number of ['001', '002']) {
    const workspace = join(workspaceRoot, number, 'source-run/workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'index.html'), '<!doctype html>');
  }
  const output = join(root, 'output with spaces');
  return {
    root, output,
    env: dockerEnvironment(root, environment),
    args: [
      launcher, 'eval:batch', `--workspace-root=${workspaceRoot}`, '--workspace-layout=run-tree',
      '--ids=frontenjoyai-001,frontenjoyai-002', `--output-root=${output}`, '--dry-run',
    ],
  };
}

function calls(environment) {
  return readFileSync(environment.DOCKER_CALLS, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('public batch command uses one scheduler and separate Docker homes, logs, and output mounts', (context) => {
  const setup = fixture(context, { EVAL_MODEL: 'configured-judge' });
  const result = spawnSync('bash', [...setup.args, '--jobs=2', '--reasoning=xhigh', '--max-remediation=1'], {
    env: setup.env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  const runs = calls(setup.env).filter((args) => args[0] === 'run');
  assert.equal(runs.length, 2);
  for (const suffix of [',dst=/codex-home', ',dst=/output']) {
    assert.equal(new Set(runs.map((args) => args.find((argument) => argument.endsWith(suffix)))).size, 2);
  }
  for (const args of runs) {
    assert.ok(args.includes('eval:pipeline'));
    assert.ok(args.includes('--codex-model=configured-judge'));
    assert.ok(args.includes('--reasoning=xhigh'));
    assert.ok(args.includes('--max-remediation=1'));
    assert.ok(args.some((argument) => argument.endsWith(',dst=/target,readonly')));
    assert.ok(!args.some((argument) => argument.includes('personal-codex-home')));
  }
  const state = JSON.parse(readFileSync(join(setup.output, 'batch-state.json')));
  assert.equal(state.jobs, 2);
  assert.equal(state.executor, 'docker');
  assert.equal(state.status, 'prepared');
  assert.equal(state.harness, 'opencode');
  assert.equal(state.entries.length, 2);
  assert.equal(state.final_score, null);
  assert.equal(new Set(state.entries.map((entry) => entry.pipeline_result.logPath)).size, 2);
});

test('public batch command reports worker errors and honors fail-fast', (context) => {
  const setup = fixture(context, { DOCKER_RUN_EXIT: '7', DOCKER_NO_STATE: '1' });
  const result = spawnSync('bash', [...setup.args, '--jobs=1', '--fail-fast'], { env: setup.env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 2, result.stderr);
  const summary = JSON.parse(readFileSync(join(setup.output, 'batch-summary.json')));
  assert.equal(summary.status, 'completed-with-errors');
  assert.equal(summary.counts.error, 1);
  assert.equal(summary.counts.skipped, 1);
  assert.equal(calls(setup.env).filter((args) => args[0] === 'run').length, 1);
});

test('public batch command never reuses nonempty output directories', (context) => {
  const setup = fixture(context);
  mkdirSync(setup.output);
  writeFileSync(join(setup.output, 'keep.txt'), 'original');
  const result = spawnSync('bash', setup.args, { env: setup.env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Output directory is not empty/u);
  assert.equal(readFileSync(join(setup.output, 'keep.txt'), 'utf8'), 'original');
  assert.equal(calls(setup.env).filter((args) => args[0] === 'run').length, 0);
});

test('workers with missing, unfinished, or inconsistent state cannot report success', (context) => {
  for (const environment of [
    { DOCKER_NO_STATE: '1' },
    { DOCKER_PIPELINE_STATUS: 'auditing' },
    { DOCKER_PIPELINE_STATUS: 'invalid', DOCKER_RUN_EXIT: '2' },
  ]) {
    const setup = fixture(context, environment);
    const result = spawnSync('bash', [...setup.args, '--jobs=2'], { env: setup.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 2, result.stderr);
    const summary = JSON.parse(readFileSync(join(setup.output, 'batch-summary.json')));
    assert.equal(summary.counts.error, 2);
    assert.equal(summary.status, 'completed-with-errors');
  }
});

test('public command help does not start Docker or create output', (context) => {
  const setup = fixture(context);
  for (const command of ['eval:pipeline', 'eval:batch', 'judge', 'score:final', 'references:verify']) {
    const result = spawnSync('bash', [launcher, command, '--help'], { env: setup.env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /Usage:/u);
  }
  assert.equal(existsSync(setup.env.DOCKER_CALLS), false);
  assert.equal(existsSync(setup.output), false);
});

test('terminating a batch stops its named containers and records cancellation', async (context) => {
  const setup = fixture(context, { DOCKER_HOLD_RUN: '1' });
  const child = spawn('bash', [...setup.args, '--jobs=1'], { env: setup.env, stdio: 'ignore' });
  context.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolveExit(code));
  });
  let started = false;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (existsSync(setup.env.DOCKER_CALLS) && calls(setup.env).some((args) => args[0] === 'run')) {
      started = true;
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.equal(started, true, 'worker did not start');
  child.kill('SIGTERM');
  assert.equal(await exited, 143);
  const commands = calls(setup.env);
  const run = commands.find((args) => args[0] === 'run');
  const name = run[run.indexOf('--name') + 1];
  assert.ok(commands.some((args) => args[0] === 'stop' && args.includes(name)));
  const summary = JSON.parse(readFileSync(join(setup.output, 'batch-summary.json')));
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.counts.cancelled, 1);
  assert.equal(summary.counts.skipped, 1);
  assert.equal(summary.final_score, null);
});
