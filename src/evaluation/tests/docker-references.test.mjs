import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { dataRoot } from '../scripts/lib/config.mjs';
import { dockerEnvironment } from './helpers/docker-stub.mjs';

const evaluationRoot = fileURLToPath(new URL('../', import.meta.url));
const entrypoint = join(evaluationRoot, 'scripts/docker-entrypoint.sh');

test('relocated Docker entrypoint preserves command arguments and exit status', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-docker-entrypoint-'));
  try {
    const executable = join(root, 'node');
    writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`);
    chmodSync(executable, 0o755);
    const argumentsList = ['--id=frontenjoyai-001', '--output-root=/output/path with spaces'];
    for (const command of ['eval', 'eval:pipeline', 'eval:batch', 'judge', 'judge:strict', 'score:final', 'references:verify', 'verify:references', 'codex']) {
      const result = spawnSync('bash', [entrypoint, command, ...argumentsList], {
        cwd: evaluationRoot,
        encoding: 'utf8',
        env: { PATH: `${root}:/usr/bin:/bin` },
      });
      assert.equal(result.status, 7, `${command}: ${result.stderr}`);
      assert.deepEqual(JSON.parse(result.stdout), ['scripts/cli.mjs', command, ...argumentsList], command);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relocated Docker entrypoint retains help and rejects unknown commands', () => {
  for (const argumentsList of [[], ['help'], ['--help'], ['-h']]) {
    const result = spawnSync('bash', [entrypoint, ...argumentsList], { cwd: evaluationRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: front-auto-eval/u);
  }
  const result = spawnSync('bash', [entrypoint, 'unknown-command'], { cwd: evaluationRoot, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: unknown-command/u);
});

test('Docker single-question mounts retain the reference-set manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-reference-docker-'));
  try {
    const fakeBin = join(root, 'bin');
    const candidate = join(root, 'candidate');
    mkdirSync(fakeBin);
    mkdirSync(candidate);
    const docker = join(fakeBin, 'docker');
    writeFileSync(docker, `#!/usr/bin/env node
import('node:fs').then(({ writeFileSync }) => {
  if (process.argv[2] === 'run') writeFileSync(process.env.DOCKER_ARGS_OUTPUT, JSON.stringify(process.argv.slice(2)));
});
`);
    chmodSync(docker, 0o755);
    const output = join(root, 'docker.json');
    for (const selection of ['frontenjoyai-029', 'frontenjoyai-029/scenes.json', 'frontenjoyai-002', 'frontenjoyai-002/scenes.json']) {
      const result = spawnSync('bash', [
        fileURLToPath(new URL('../scripts/docker-run.sh', import.meta.url)), 'eval:pipeline',
        `--prompts=${dataRoot}`, `--workspace=${candidate}`,
        `--benchmark=${join(dataRoot, 'references', selection)}`,
        `--id=${selection.split('/')[0]}`, `--output-root=${join(root, 'output', selection)}`, '--dry-run',
      ], {
        encoding: 'utf8',
        env: {
          PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root,
          AUTO_EVAL_ENV_FILE: '', AUTO_EVAL_SKIP_BUILD: 'true',
          AUTO_EVAL_CODEX_HOME: join(root, 'codex-home'), DOCKER_ARGS_OUTPUT: output,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const argumentsList = JSON.parse(readFileSync(output));
      assert.ok(argumentsList.includes(`type=bind,src=${join(dataRoot, 'references')},dst=/benchmark-set,readonly`));
      assert.ok(argumentsList.includes(`--benchmark=/benchmark-set/${selection}`));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Docker evaluation does not discover unselected adjacent reference applications', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-reference-docker-default-'));
  try {
    const fakeBin = join(root, 'bin');
    const candidateRoot = join(root, 'comparison/candidate');
    const candidate = join(candidateRoot, 'frontenjoyai-001');
    const adjacentReference = join(root, 'comparison/benchmark/frontenjoyai-001');
    mkdirSync(fakeBin);
    mkdirSync(candidate, { recursive: true });
    mkdirSync(adjacentReference, { recursive: true });
    writeFileSync(join(adjacentReference, 'index.html'), '<title>Reference application</title>');
    writeFileSync(join(candidate, 'index.html'), '<!doctype html>');
    const environment = dockerEnvironment(root);
    const output = environment.DOCKER_ARGS_OUTPUT;
    for (const command of ['eval:pipeline', 'eval:batch']) {
      const workspaceArgument = command === 'eval:pipeline'
        ? `--workspace=${candidate}` : `--workspace-root=${candidateRoot}`;
      const questionArgument = command === 'eval:pipeline' ? '--id=frontenjoyai-001' : '--ids=frontenjoyai-001';
      const result = spawnSync('bash', [
        fileURLToPath(new URL('../scripts/docker-run.sh', import.meta.url)), command,
        `--prompts=${dataRoot}`, workspaceArgument,
        questionArgument, `--output-root=${join(root, 'output', command)}`, '--dry-run',
      ], {
        encoding: 'utf8',
        env: environment,
      });
      assert.equal(result.status, 0, result.stderr);
      const argumentsList = JSON.parse(readFileSync(output));
      assert.ok(!argumentsList.some((argument) => argument.includes('/comparison/benchmark')));
      if (command === 'eval:pipeline') {
        assert.ok(!argumentsList.some((argument) => /^--benchmark(?:-root)?=/u.test(argument)));
      } else {
        assert.ok(argumentsList.some((argument) => argument.includes('data/references')));
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
