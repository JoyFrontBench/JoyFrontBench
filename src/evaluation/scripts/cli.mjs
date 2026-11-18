#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runEvaluationBatch } from './lib/batch.mjs';
import {
  codexProviderArgs,
  commandUsage,
  evaluationRoot,
  loadEnvironment,
  parseCommandArgs,
} from './lib/config.mjs';
import { createDockerExecutor } from './lib/docker-executor.mjs';
import { runJudge } from './lib/judge.mjs';
import { runPipeline } from './lib/pipeline.mjs';
import { verifyReferenceSet } from './lib/references.mjs';
import { scorePipelineRuns } from './lib/scoring.mjs';
import { parsePromptGroups } from './lib/tasks.mjs';

const commands = {
  'eval:pipeline': 'Evaluate one application, audit evidence, and remediate reports.',
  'eval:batch': 'Evaluate selected applications and automatically compute final scores.',
  judge: 'Audit existing reports and evidence without model calls.',
  'score:final': 'Compute ATS, CTPR, ASR, and eight capability scores without model calls.',
  'references:verify': 'Validate the bundled reference images and scene mappings.',
  codex: 'Run Codex using the evaluation API configuration.',
  check: 'Check evaluation JavaScript, shell syntax, and the Playwright installation.',
  test: 'Run evaluation tests.',
};
const aliases = {
  eval: ['eval:pipeline'],
  'judge:strict': ['judge', '--strict'],
  'verify:references': ['references:verify'],
};

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runProcess(command, args) {
  const result = spawnSync(command, args, { cwd: evaluationRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }).sort();
}

function checkSources() {
  for (const path of sourceFiles(join(evaluationRoot, 'scripts'))) {
    const code = path.endsWith('.mjs') ? runProcess(process.execPath, ['--check', path])
      : path.endsWith('.sh') ? runProcess('bash', ['-n', path]) : 0;
    if (code !== 0) return code;
  }
  createRequire(import.meta.url)('playwright');
  return 0;
}

function runCodex(argv) {
  const environment = loadEnvironment();
  const provider = environment.CODEX_PROVIDER || (environment.OPENAI_API_KEY ? 'api' : 'codex');
  const configured = codexProviderArgs({ provider }, environment);
  const customModel = argv.some((argument) => argument === '-m' || argument === '--model' || argument.startsWith('--model='));
  const prefix = provider === 'codex' ? [] : (customModel ? configured.slice(2) : configured);
  const result = spawnSync(environment.CODEX_BIN || 'codex', [...prefix, ...argv], { env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function runBatch(options) {
  if (options.executor === 'local' && options.jobs !== 1) {
    throw new Error('Parallel evaluation requires isolated Docker workers. Use docker-run.sh eval:batch --jobs=N.');
  }
  const controller = new AbortController();
  const onInterrupt = () => controller.abort('SIGINT');
  const onTerminate = () => controller.abort('SIGTERM');
  const executor = options.executor === 'docker'
    ? createDockerExecutor({ outputRoot: options.outputRoot, signal: controller.signal }) : null;
  if (executor) {
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
  }
  try {
    const result = await runEvaluationBatch(options, executor
      ? { pipelineRunner: executor.run, signal: controller.signal } : {});
    printJson({ status: result.status, counts: result.counts, finalScore: result.final_score, summaryPath: result.summaryPath });
    if (controller.signal.aborted) return controller.signal.reason === 'SIGINT' ? 130 : 143;
    return ['completed-with-errors', 'completed-with-followup'].includes(result.status) ? 2 : 0;
  } finally {
    if (executor) {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      await executor.close();
    }
  }
}

export async function runCli(argv) {
  let [command = 'help', ...args] = argv;
  if (['help', '--help', '-h'].includes(command)) {
    process.stdout.write(`Usage: front-auto-eval <command> [options]\n\n${Object.entries(commands).map(([name, description]) => `  ${name.padEnd(19)} ${description}`).join('\n')}\n\nUse <command> --help for options.\n`);
    return 0;
  }
  if (aliases[command]) {
    const [canonical, ...prefix] = aliases[command];
    command = canonical;
    args = [...prefix, ...args];
  }
  if (!Object.hasOwn(commands, command)) {
    process.stderr.write(`Unknown command: ${command}\n`);
    return 2;
  }
  if (['check', 'test', 'codex'].includes(command)) {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(`Usage: front-auto-eval ${command}${command === 'codex' ? ' [Codex options]' : ''}\n`);
      return 0;
    }
    if (command === 'codex') return runCodex(args);
    if (args.length) throw new Error(`Unknown option: ${args[0]}`);
    if (command === 'check') return checkSources();
    return runProcess(process.execPath, ['--test', ...sourceFiles(join(evaluationRoot, 'tests')).filter((path) => path.endsWith('.test.mjs'))]);
  }
  const options = parseCommandArgs(command, args);
  if (options.help) {
    process.stdout.write(`${commands[command]}\n\n${commandUsage(command)}`);
    return 0;
  }
  if (command === 'eval:pipeline') {
    const result = await runPipeline(options);
    printJson(result);
    return ['prepared', 'ready', 'needs-followup'].includes(result.status) ? 0 : 2;
  }
  if (command === 'eval:batch') return runBatch(options);
  if (command === 'judge') {
    const result = runJudge(options);
    printJson({ status: result.status, counts: result.counts, reportPath: result.reportPath, jsonPath: result.jsonPath });
    return options.failOnHigh && result.counts.high > 0 ? 2 : 0;
  }
  if (command === 'score:final') {
    const output = scorePipelineRuns(options);
    printJson({ jsonPath: output.jsonPath, markdownPath: output.markdownPath, manifestPath: output.manifestPath, capabilityDimensionsAvailable: output.result.capability_dimensions.status === 'ready' });
    return 0;
  }
  const { manifest } = verifyReferenceSet(resolve(options.root), parsePromptGroups(resolve(options.promptsRoot)));
  printJson({
    id: manifest.id,
    protocol: manifest.protocol,
    questions: manifest.questions.length,
    pairwise: manifest.questions.filter((question) => question.usage === 'pairwise').length,
    status: 'verified',
    scenes: manifest.questions.reduce((total, question) => total + question.scene_count, 0),
    frames: manifest.questions.reduce((total, question) => total + question.frame_count, 0),
  });
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  }
}
