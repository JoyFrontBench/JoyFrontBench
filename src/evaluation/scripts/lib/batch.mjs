import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { assertDirectory } from './config.mjs';
import { runPipeline } from './pipeline.mjs';
import { defaultReferenceRoot, resolveVisualReferenceTarget } from './references.mjs';
import { resolveWorkspaceTarget } from './run-workspaces.mjs';
import { scorePipelineRuns } from './scoring.mjs';
import { parsePromptGroups } from './tasks.mjs';

function resolveFreshOutput(path) {
  if (!path) throw new Error('Missing --output-root.');
  const resolved = resolve(path);
  if (existsSync(resolved) && readdirSync(resolved).length) {
    throw new Error(`Output directory is not empty: ${resolved}. Use a new path.`);
  }
  return resolved;
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z').replace('T', '-');
}

function repetitionRunId(baseRunId, repetition, repetitions) {
  if (repetitions === 1) return baseRunId;
  const width = Math.max(2, String(repetitions).length);
  return `${baseRunId}-r${String(repetition).padStart(width, '0')}`;
}

function hasPairwiseTask(group) {
  return group.requirements.some((requirement) => requirement.judgeMode === 'pairwise_gsb');
}

function questionDirectoryCandidates(root, group) {
  return [...new Set([
    group.id,
    group.taskKey,
    String(group.number).padStart(3, '0'),
  ])].map((name) => join(root, name));
}

function resolveQuestionDirectory(root, group, label) {
  const directory = questionDirectoryCandidates(root, group)
    .find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory());
  if (!directory) {
    throw new Error(`Missing ${label} for ${group.id}; tried: ${questionDirectoryCandidates(root, group).join(', ')}`);
  }
  return directory;
}

function resolveProjectWorkspace(workspace) {
  const direct = resolveWorkspaceTarget(workspace);
  if (direct.mode !== 'unlaunchable') return workspace;
  const runnableChildren = readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workspace, entry.name))
    .filter((candidate) => resolveWorkspaceTarget(candidate).mode !== 'unlaunchable');
  if (runnableChildren.length === 1) return runnableChildren[0];
  if (!runnableChildren.length) return workspace;
  throw new Error(`Multiple runnable projects found in workspace: ${workspace}`);
}

function discoverRunTree(questionDirectory) {
  return readdirSync(questionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      runId: entry.name,
      runRoot: join(questionDirectory, entry.name),
      workspaceRoot: join(questionDirectory, entry.name, 'workspace'),
    }))
    .filter((entry) => (existsSync(entry.workspaceRoot) && statSync(entry.workspaceRoot).isDirectory())
      || existsSync(join(entry.runRoot, 'metadata.json')))
    .sort((left, right) => left.runId.localeCompare(right.runId));
}

function inferHarness(workspaceRoot, configuredHarness) {
  if (configuredHarness) return configuredHarness;
  const parentName = basename(resolve(workspaceRoot, '..'));
  return ['openhands', 'opencode', 'codex'].includes(parentName) ? parentName : 'direct';
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function selectedPromptGroups(repository, ids) {
  if (!ids.length) return repository.groups;
  const knownIds = new Set(repository.groups.map((group) => group.id));
  const unknownIds = ids.filter((id) => !knownIds.has(id));
  if (unknownIds.length) {
    throw new Error(`Unknown question id(s): ${unknownIds.join(', ')}.`);
  }
  const selected = new Set(ids);
  return repository.groups.filter((group) => selected.has(group.id));
}

export function buildBatchPlan({
  repository,
  workspaceRoot,
  benchmarkRoot,
  outputRoot,
  ids = [],
  repetitions = 1,
  runId,
  workspaceLayout = 'auto',
}) {
  if (!['auto', 'questions', 'run-tree'].includes(workspaceLayout)) {
    throw new Error('--workspace-layout must be auto, questions, or run-tree.');
  }
  const groups = selectedPromptGroups(repository, ids);
  const entries = [];
  for (const group of groups) {
    const questionDirectory = resolveQuestionDirectory(workspaceRoot, group, 'question workspace');
    const discoveredRuns = discoverRunTree(questionDirectory);
    const useRunTree = workspaceLayout === 'run-tree'
      || (workspaceLayout === 'auto' && discoveredRuns.length > 0);
    if (workspaceLayout === 'run-tree' && !discoveredRuns.length) {
      throw new Error(`No run-tree workspaces found for ${group.id}: ${questionDirectory}`);
    }
    if (useRunTree && repetitions !== 1) {
      throw new Error('--repetitions must be 1 when workspace layout is run-tree.');
    }
    let benchmark = '';
    if (benchmarkRoot && hasPairwiseTask(group)) {
      const benchmarkDirectory = resolveQuestionDirectory(benchmarkRoot, group, 'benchmark workspace');
      benchmark = resolveVisualReferenceTarget(benchmarkDirectory, group.id)?.workspacePath
        || resolveProjectWorkspace(benchmarkDirectory);
    } else if (hasPairwiseTask(group) && useRunTree) {
      throw new Error(`Pairwise run-tree evaluation requires --benchmark-root for ${group.id}.`);
    }
    const sources = useRunTree
      ? discoveredRuns.map((entry) => ({
          repetition: 1,
          runId: entry.runId,
          runRoot: entry.runRoot,
          workspace: entry.workspaceRoot,
        }))
      : Array.from({ length: repetitions }, (_, index) => ({
          repetition: index + 1,
          runId: repetitionRunId(runId, index + 1, repetitions),
          runRoot: questionDirectory,
          workspace: questionDirectory,
        }));
    for (const source of sources) {
      entries.push({
        question_no: group.number,
        question_id: group.id,
        workspace_layout: useRunTree ? 'run-tree' : 'questions',
        repetition: source.repetition,
        run_id: source.runId,
        source_run_root: source.runRoot,
        workspace: source.workspace,
        benchmark,
        output_root: join(outputRoot, 'runs', source.runId, group.id),
        status: 'pending',
      });
    }
  }
  return entries;
}

function summarizeEntries(entries) {
  const counts = {
    total: entries.length,
    pending: 0,
    running: 0,
    prepared: 0,
    ready: 0,
    'needs-followup': 0,
    invalid: 0,
    blocked: 0,
    error: 0,
    cancelled: 0,
    skipped: 0,
  };
  for (const entry of entries) {
    const status = counts[entry.status] === undefined ? 'error' : entry.status;
    counts[status] += 1;
  }
  return counts;
}

export async function runEvaluationBatch(options, dependencies = {}) {
  const pipelineRunner = dependencies.pipelineRunner || runPipeline;
  const finalScorer = dependencies.finalScorer || scorePipelineRuns;
  const signal = dependencies.signal;
  const jobs = options.jobs ?? 1;
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) {
    throw new Error('--jobs must be an integer between 1 and 32.');
  }
  if (jobs > 1 && !dependencies.pipelineRunner) {
    throw new Error('Parallel evaluation requires an isolated pipeline executor.');
  }
  const promptsRoot = assertDirectory(options.promptsRoot, '--prompts');
  const workspaceRoot = assertDirectory(options.workspaceRoot, '--workspace-root');
  const repository = parsePromptGroups(promptsRoot);
  const benchmarkRoot = options.benchmarkRoot
    ? assertDirectory(options.benchmarkRoot, '--benchmark-root')
    : defaultReferenceRoot(promptsRoot, repository);
  const outputRoot = resolveFreshOutput(options.outputRoot);
  const modelLabel = options.modelLabel || basename(workspaceRoot);
  const harness = inferHarness(workspaceRoot, options.harness);
  const baseRunId = options.runId || `${modelLabel}-${timestampId()}`;
  const runsRoot = join(outputRoot, 'runs');
  const entries = buildBatchPlan({
    repository,
    workspaceRoot,
    benchmarkRoot,
    outputRoot,
    ids: options.ids,
    repetitions: options.repetitions,
    runId: baseRunId,
    workspaceLayout: options.workspaceLayout || 'auto',
  });
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(runsRoot, { recursive: true });
  const statePath = join(outputRoot, 'batch-state.json');
  const summaryPath = join(outputRoot, 'batch-summary.json');
  const state = {
    version: 1,
    status: options.dryRun ? 'preparing' : 'running',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    prompts_root: promptsRoot,
    workspace_root: workspaceRoot,
    benchmark_root: benchmarkRoot || null,
    output_root: outputRoot,
    runs_root: runsRoot,
    final_score_root: options.dryRun ? null : join(outputRoot, 'final-score'),
    workspace_layout: options.workspaceLayout || 'auto',
    harness,
    model: modelLabel,
    base_run_id: baseRunId,
    repetitions: options.repetitions,
    expected_runs_per_question: options.expectedRuns,
    core_policy: options.corePolicyPath || null,
    dry_run: options.dryRun,
    jobs,
    executor: options.executor || 'local',
    entries,
    final_score: null,
  };
  writeJson(statePath, state);

  let stop = false;
  let nextEntry = 0;
  const worker = async () => {
    while (nextEntry < entries.length) {
      const index = nextEntry++;
      const entry = entries[index];
      if (stop || signal?.aborted) {
        entry.status = 'skipped';
        continue;
      }
      entry.status = 'running';
      entry.started_at = new Date().toISOString();
      state.updated_at = entry.started_at;
      writeJson(statePath, state);
      try {
        entry.workspace = resolveProjectWorkspace(entry.workspace);
        const result = await pipelineRunner({
          promptsRoot,
          workspace: entry.workspace,
          benchmark: entry.benchmark,
          outputRoot: entry.output_root,
          id: entry.question_id,
          number: entry.question_no,
          harness,
          modelLabel,
          runId: entry.run_id,
          codexModel: options.codexModel,
          provider: options.provider,
          reasoning: options.reasoning,
          codexBin: options.codexBin,
          maxRemediation: options.maxRemediation,
          dryRun: options.dryRun,
        }, index);
        entry.status = result.status;
        entry.pipeline_result = result;
      } catch (error) {
        entry.status = signal?.aborted ? 'cancelled' : 'error';
        entry.error = error.stack || error.message || String(error);
        if (options.failFast) stop = true;
      }
      entry.finished_at = new Date().toISOString();
      state.updated_at = entry.finished_at;
      writeJson(statePath, state);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, entries.length) }, worker));

  let finalScore = null;
  if (!options.dryRun && !signal?.aborted) {
    try {
      const scored = await finalScorer({
        promptsRoot,
        runsRoot,
        outputRoot: join(outputRoot, 'final-score'),
        expectedRuns: options.expectedRuns,
        corePolicyPath: options.corePolicyPath,
      });
      finalScore = {
        status: 'completed',
        discovered_run_count: scored.result.source.discovered_run_count,
        primary_metric: scored.result.scoring_policy?.primary_metric || null,
        core_metrics_available: scored.result.core_scoring?.status === 'ready',
        capability_dimensions_available: scored.result.capability_dimensions?.status === 'ready',
        json_path: scored.jsonPath,
        markdown_path: scored.markdownPath,
        manifest_path: scored.manifestPath,
        diagnostic_count: scored.result.diagnostics.length,
      };
    } catch (error) {
      finalScore = {
        status: 'error',
        error: error.stack || error.message || String(error),
      };
    }
  }

  const counts = summarizeEntries(entries);
  const hasErrors = counts.error > 0 || finalScore?.status === 'error';
  const hasUnresolved = counts['needs-followup'] > 0 || counts.invalid > 0 || counts.blocked > 0;
  const status = signal?.aborted
    ? 'cancelled'
    : hasErrors
      ? 'completed-with-errors'
      : options.dryRun
        ? 'prepared'
      : hasUnresolved
        ? 'completed-with-followup'
        : 'completed';
  const summary = {
    version: 1,
    status,
    started_at: state.started_at,
    finished_at: new Date().toISOString(),
    prompts_root: promptsRoot,
    workspace_root: workspaceRoot,
    benchmark_root: benchmarkRoot || null,
    output_root: outputRoot,
    runs_root: runsRoot,
    workspace_layout: options.workspaceLayout || 'auto',
    harness,
    model: modelLabel,
    base_run_id: baseRunId,
    repetitions: options.repetitions,
    expected_runs_per_question: options.expectedRuns,
    jobs,
    executor: options.executor || 'local',
    counts,
    final_score: finalScore,
    entries,
  };
  state.status = status;
  state.updated_at = summary.finished_at;
  state.final_score = finalScore;
  writeJson(statePath, state);
  writeJson(summaryPath, summary);
  return { ...summary, statePath, summaryPath };
}
