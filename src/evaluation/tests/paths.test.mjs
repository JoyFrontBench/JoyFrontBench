import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writePromptRepository } from './helpers/prompt-repository.mjs';

const configModule = fileURLToPath(new URL('../scripts/lib/config.mjs', import.meta.url));
const expectedRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function readPaths(modulePath, cwd, repositoryRoot = '') {
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import * as paths from ${JSON.stringify(pathToFileURL(modulePath).href)}; console.log(JSON.stringify(paths));`,
  ], {
    cwd,
    env: { ...process.env, FRONT_REPO_ROOT: repositoryRoot },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('source paths locate data and outputs independently of the working directory', () => {
  const paths = readPaths(configModule, tmpdir());
  assert.equal(paths.repositoryRoot, expectedRoot);
  assert.equal(paths.dataRoot, join(expectedRoot, 'data'));
  assert.equal(paths.evaluationOutputRoot, join(expectedRoot, 'eval-output'));
});

test('installed evaluator paths honor the container repository root', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-installed-paths-'));
  try {
    const repositoryRoot = join(root, 'opt');
    const installedModule = join(repositoryRoot, 'front-auto-eval/scripts/lib/config.mjs');
    mkdirSync(dirname(installedModule), { recursive: true });
    copyFileSync(configModule, installedModule);
    const paths = readPaths(installedModule, root, repositoryRoot);
    assert.equal(paths.repositoryRoot, repositoryRoot);
    assert.equal(paths.dataRoot, join(repositoryRoot, 'data'));
    assert.equal(paths.evaluationOutputRoot, join(repositoryRoot, 'eval-output'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installed evaluator prepares a pipeline with the relocated Skills from any working directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-installed-pipeline-'));
  try {
    const repositoryRoot = join(root, 'opt');
    const installedRoot = join(repositoryRoot, 'front-auto-eval');
    const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
    for (const directory of ['scripts', 'skills']) {
      cpSync(join(sourceRoot, directory), join(installedRoot, directory), { recursive: true });
    }
    const promptsRoot = join(repositoryRoot, 'data');
    writePromptRepository(promptsRoot, [{
      number: 29,
      id: 'frontenjoyai-029',
      categories: ['图形', 'SVG'],
      prompt: '实现一个可交互的章鱼爵士鼓页面。\n',
      tasks: [{ task_id: '1', judge_mode: 'pointwise', task: '鼓面交互', criteria: ['点击鼓面产生反馈'] }],
    }]);
    const workspace = join(root, 'workspace');
    const outputRoot = join(root, 'output');
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'index.html'), '<!doctype html>');
    const result = spawnSync(process.execPath, [
      join(installedRoot, 'scripts/cli.mjs'), 'eval:pipeline',
      `--prompts=${promptsRoot}`,
      `--workspace=${workspace}`,
      '--id=frontenjoyai-029',
      `--output-root=${outputRoot}`,
      '--dry-run',
    ], {
      cwd: root,
      env: { ...process.env, FRONT_REPO_ROOT: repositoryRoot, FRONT_ENV_FILE: '' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    const context = JSON.parse(readFileSync(join(outputRoot, 'pipeline-context.json'), 'utf8'));
    assert.deepEqual(context.skills, {
      pipeline: join(installedRoot, 'skills/pipeline/SKILL.md'),
      common: join(installedRoot, 'skills/page-evaluation/SKILL.md'),
      topic: join(installedRoot, 'skills/page-evaluation/topics/octopus-drum-svg/SKILL.md'),
      report: join(installedRoot, 'skills/report-generation/SKILL.md'),
      judge: join(installedRoot, 'skills/judge/SKILL.md'),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
