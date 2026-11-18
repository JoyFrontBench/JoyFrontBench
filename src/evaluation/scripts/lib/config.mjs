import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(
  process.env.FRONT_REPO_ROOT || fileURLToPath(new URL('../../../../', import.meta.url)),
);
export const dataRoot = join(repositoryRoot, 'data');
export const evaluationOutputRoot = join(repositoryRoot, 'eval-output');
export const evaluationRoot = fileURLToPath(new URL('../../', import.meta.url));

export const DEFAULT_API_BASE = 'https://api.openai.com/v1';
export const DEFAULT_EVAL_MODEL = 'gpt-5.5';

export function assertDirectory(path, label) {
  if (!path) throw new Error(`Missing ${label}.`);
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${label} must be an existing directory: ${resolved}`);
  }
  return resolved;
}

export function loadEnvironment(envFile = '', environment = process.env, root = repositoryRoot) {
  const path = envFile || (environment.AUTO_EVAL_ENV_FILE
    ?? environment.FRONT_ENV_FILE ?? resolve(root, '.env'));
  const values = {};
  if (existsSync(path)) {
    for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      const match = rawLine.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
      if (!match) continue;
      let value = match[2].trim();
      if (value.length >= 2 && (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      )) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/u, '').trim();
      }
      values[match[1]] = value;
    }
  }
  return { ...values, ...environment };
}

export function resolveApiConfig({
  environment = loadEnvironment(),
  apiBase = '',
  apiKeyEnv = 'OPENAI_API_KEY',
  requireKey = true,
} = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(apiKeyEnv)) {
    throw new Error('Invalid API key environment variable name.');
  }
  const base = String(apiBase || environment.OPENAI_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/u, '');
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('OPENAI_BASE_URL must be an HTTP(S) API base URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('OPENAI_BASE_URL must be an HTTP(S) API base URL without credentials, query or fragment.');
  }
  const apiKey = String(environment[apiKeyEnv] || '').trim();
  if (requireKey && !apiKey) {
    throw new Error(`Missing ${apiKeyEnv}; configure it in the repository .env or current environment.`);
  }
  return { apiBase: base, apiKeyEnv, apiKey };
}

export function codexProviderArgs(options, environment = loadEnvironment()) {
  const provider = options.provider || 'api';
  const model = options.codexModel || environment.EVAL_MODEL || DEFAULT_EVAL_MODEL;
  const reasoning = options.reasoning || environment.CODEX_REASONING_EFFORT || 'high';
  if (!['low', 'medium', 'high', 'xhigh'].includes(reasoning)) {
    throw new Error('CODEX_REASONING_EFFORT must be low, medium, high, or xhigh.');
  }
  const common = ['-m', model, '-c', `model_reasoning_effort=${JSON.stringify(reasoning)}`];
  if (provider === 'codex') return common;
  if (provider !== 'api') throw new Error('--provider must be api or codex.');
  const api = resolveApiConfig({ environment, requireKey: !options.dryRun });
  return [
    ...common,
    '-c', 'model_provider="benchmark"',
    '-c', 'model_providers.benchmark.name="Benchmark API"',
    '-c', `model_providers.benchmark.base_url=${JSON.stringify(api.apiBase)}`,
    '-c', `model_providers.benchmark.env_key=${JSON.stringify(api.apiKeyEnv)}`,
    '-c', 'model_providers.benchmark.wire_api="responses"',
    '-c', 'model_providers.benchmark.request_max_retries=3',
    '-c', 'model_providers.benchmark.stream_max_retries=3',
    '-c', 'model_providers.benchmark.stream_idle_timeout_ms=3600000',
  ];
}

const value = (names, fallback = '', settings = {}) => ({ names: names.split(' '), fallback, ...settings });
const flag = (name) => value(name, false, { boolean: true });
const integer = (names, fallback, minimum, maximum) => value(names, fallback, { minimum, maximum });
const choice = (name, fallback, choices) => value(name, fallback, { choices });

function definitions(command, environment) {
  const common = {
    promptsRoot: value('--prompts --prompt-repository', environment.EVAL_PROMPTS_PATH || dataRoot),
    outputRoot: value('--output-root --output'),
  };
  const scoring = {
    expectedRuns: integer('--expected-runs', 3, 1, 100),
    corePolicyPath: value('--core-policy'),
  };
  const evaluator = {
    harness: value('--harness'),
    modelLabel: value('--model --model-label --candidate-model'),
    runId: value('--run-id'),
    codexModel: value('--codex-model', environment.EVAL_MODEL || DEFAULT_EVAL_MODEL),
    provider: choice('--provider', 'api', ['api', 'codex']),
    reasoning: choice('--reasoning', environment.CODEX_REASONING_EFFORT || 'high', ['low', 'medium', 'high', 'xhigh']),
    codexBin: value('--codex-bin', environment.CODEX_BIN || 'codex'),
    maxRemediation: integer('--max-remediation', 3, 0, 10),
    dryRun: flag('--dry-run'),
  };
  switch (command) {
    case 'eval:pipeline':
      return {
        ...common,
        ...evaluator,
        workspace: value('--workspace'),
        benchmark: value('--benchmark'),
        id: value('--id'),
        number: integer('--number --task', 0, 0, Number.MAX_SAFE_INTEGER),
        harness: value('--harness', 'direct'),
        modelLabel: value('--model --model-label --candidate-model', 'unknown'),
      };
    case 'eval:batch':
      return {
        ...common,
        ...evaluator,
        ...scoring,
        workspaceRoot: value('--workspace-root --workspaces'),
        benchmarkRoot: value('--benchmark-root'),
        workspaceLayout: choice('--workspace-layout', 'auto', ['auto', 'questions', 'run-tree']),
        ids: value('--ids', [], { multiple: true }),
        repetitions: integer('--repetitions', 1, 1, 100),
        jobs: integer('--jobs --concurrency', 1, 1, 32),
        executor: choice('--executor', 'local', ['local', 'docker']),
        failFast: flag('--fail-fast'),
      };
    case 'score:final':
      return { ...common, ...scoring, runsRoot: value('--runs-root') };
    case 'judge':
      return {
        promptsRoot: common.promptsRoot,
        reportRoot: value('--report-root --reports', environment.EVAL_REPORT_ROOT || join(evaluationOutputRoot, 'reports')),
        resultsPath: value('--results'),
        testedUrlOverride: value('--url --tested-url', environment.EVAL_TESTED_URL || ''),
        ids: value('--id', [], { multiple: true }),
        rows: value('--row', [], { multiple: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        strict: flag('--strict'),
        failOnHigh: flag('--fail-on-high'),
      };
    case 'references:verify':
      return { promptsRoot: common.promptsRoot, root: value('--root', join(dataRoot, 'references')) };
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function validateValue(definition, input) {
  const name = definition.names[0];
  if (definition.minimum !== undefined) {
    const parsed = Number(input);
    if (String(input).trim() === '' || !Number.isSafeInteger(parsed) || parsed < definition.minimum || parsed > definition.maximum) {
      throw new Error(`${name} must be an integer between ${definition.minimum} and ${definition.maximum}.`);
    }
    return parsed;
  }
  if (definition.choices && !definition.choices.includes(input)) {
    throw new Error(`${name} must be one of: ${definition.choices.join(', ')}.`);
  }
  return input;
}

export function parseCommandArgs(command, argv = [], environment) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const fields = definitions(command, environment || loadEnvironment());
  const options = {};
  const names = new Map();
  for (const [key, definition] of Object.entries(fields)) {
    options[key] = definition.multiple ? [] : definition.fallback;
    for (const name of definition.names) names.set(name, { key, definition });
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.indexOf('=');
    const name = separator < 0 ? argument : argument.slice(0, separator);
    const field = names.get(name);
    if (!field) throw new Error(`Unknown option: ${name}`);
    const { key, definition } = field;
    if (definition.boolean) {
      if (separator >= 0) throw new Error(`${name} does not take a value.`);
      options[key] = true;
      continue;
    }
    let input;
    if (separator >= 0) {
      input = argument.slice(separator + 1);
    } else {
      input = argv[index + 1];
      if (input === undefined || /^--?[^\d]/u.test(input)) throw new Error(`${name} requires a value.`);
      index += 1;
    }
    if (input === '') throw new Error(`${name} requires a value.`);
    if (definition.multiple) {
      options[key].push(...input.split(',').map((item) => item.trim()).filter(Boolean));
    } else {
      options[key] = input;
    }
  }
  for (const [key, definition] of Object.entries(fields)) {
    options[key] = definition.multiple
      ? [...new Set(options[key].map((input) => validateValue(definition, input)))]
      : validateValue(definition, options[key]);
  }
  if (command === 'judge') {
    options.ids = new Set(options.ids);
    options.rows = new Set(options.rows);
    options.resultsPath ||= join(options.reportRoot, 'eval-summary-results.json');
  }
  return options;
}

export function commandUsage(command) {
  const lines = [`Usage: node src/evaluation/scripts/cli.mjs ${command} [options]`, ''];
  for (const definition of Object.values(definitions(command, {}))) {
    const defaultValue = definition.fallback === '' || definition.multiple || definition.boolean
      ? '' : ` (default: ${definition.fallback})`;
    lines.push(`  ${definition.names.join(', ')}${definition.boolean ? '' : ' <value>'}${defaultValue}`);
  }
  lines.push('  --help, -h', '', 'Repeated scalar options use the last value; repeated selection options are combined.', '');
  return lines.join('\n');
}
