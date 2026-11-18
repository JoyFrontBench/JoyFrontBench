import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

import { evaluationRoot, loadEnvironment } from './config.mjs';

export function createDockerExecutor({ outputRoot, signal, environment = loadEnvironment(), launcher = join(evaluationRoot, 'scripts/docker-run.sh') }) {
  if (!outputRoot) throw new Error('Missing --output-root.');
  const root = resolve(outputRoot);
  const active = new Map();
  const stopping = [];
  const stopped = new Set();
  const stopWorker = (child, name) => {
    if (!child.pid || stopped.has(child)) return;
    stopped.add(child);
    child.kill('SIGTERM');
    stopping.push(new Promise((resolveStop) => {
      const stopper = spawn('docker', ['stop', '--time=5', name], { env: environment, stdio: 'ignore', timeout: 10000 });
      stopper.once('error', resolveStop);
      stopper.once('close', resolveStop);
    }));
  };
  const onAbort = () => {
    for (const [child, name] of active) stopWorker(child, name);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  return {
    async run(options, index) {
      if (signal?.aborted) throw new Error('Evaluation cancelled.');
      const workerId = `${String(index + 1).padStart(3, '0')}-${options.id}`;
      const home = join(root, 'orchestrator/codex-home', workerId);
      const logRoot = join(root, 'orchestrator/logs');
      const logPath = join(logRoot, `${workerId}.log`);
      const name = `front-eval-${process.pid}-${Date.now()}-${index + 1}`;
      mkdirSync(home, { recursive: true });
      mkdirSync(logRoot, { recursive: true });
      const args = [
        'eval:pipeline',
        `--prompts=${options.promptsRoot}`,
        `--workspace=${options.workspace}`,
        `--output-root=${options.outputRoot}`,
        `--id=${options.id}`,
        `--harness=${options.harness}`,
        `--model=${options.modelLabel}`,
        `--run-id=${options.runId}`,
        `--codex-model=${options.codexModel}`,
        `--provider=${options.provider}`,
        `--reasoning=${options.reasoning}`,
        `--codex-bin=${options.codexBin}`,
        `--max-remediation=${options.maxRemediation}`,
      ];
      if (options.benchmark) args.push(`--benchmark=${options.benchmark}`);
      if (options.dryRun) args.push('--dry-run');
      const log = createWriteStream(logPath);
      let child;
      try {
        const exitCode = await new Promise((resolveExit, reject) => {
          log.once('error', reject);
          child = spawn(launcher, args, {
            env: {
              ...environment,
              AUTO_EVAL_SKIP_BUILD: 'true',
              AUTO_EVAL_CODEX_HOME: home,
              AUTO_EVAL_CONTAINER_NAME: name,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          active.set(child, name);
          child.stdout.pipe(log, { end: false });
          child.stderr.pipe(log, { end: false });
          child.once('error', reject);
          child.once('close', resolveExit);
        });
        if (signal?.aborted) throw new Error(`Evaluation cancelled; log: ${logPath}`);
        if (exitCode !== 0 && exitCode !== 2) throw new Error(`Evaluation worker exited with code ${exitCode}; log: ${logPath}`);
        let state;
        try {
          state = JSON.parse(readFileSync(join(options.outputRoot, 'pipeline-state.json'), 'utf8'));
        } catch (error) {
          throw new Error(`Evaluation worker did not produce a readable pipeline state; log: ${logPath}`, { cause: error });
        }
        const status = state.finalStatus || state.stage;
        if (!['prepared', 'ready', 'needs-followup', 'invalid', 'blocked'].includes(status)) {
          throw new Error(`Evaluation worker did not finish (${status}); log: ${logPath}`);
        }
        if (status === 'prepared' && !options.dryRun) throw new Error(`Unexpected dry-run result; log: ${logPath}`);
        if (options.dryRun && status !== 'prepared') throw new Error(`Dry-run worker did not prepare its inputs; log: ${logPath}`);
        const expectedExit = ['invalid', 'blocked'].includes(status) ? 2 : 0;
        if (exitCode !== expectedExit) throw new Error(`Evaluation exit code does not match pipeline status; log: ${logPath}`);
        return {
          ...state,
          status,
          outputRoot: options.outputRoot,
          logPath,
        };
      } catch (error) {
        if (child && child.exitCode === null && child.signalCode === null) stopWorker(child, name);
        throw error;
      } finally {
        if (child) active.delete(child);
        await new Promise((resolveEnd) => {
          log.end(resolveEnd);
          if (log.destroyed) resolveEnd();
        });
      }
    },
    async close() {
      if (active.size) onAbort();
      await Promise.all(stopping);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
