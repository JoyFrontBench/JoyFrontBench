import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { codexProviderArgs, loadEnvironment, resolveApiConfig } from '../scripts/lib/config.mjs';

test('shared API configuration loads root dotenv with shell precedence', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-api-config-'));
  try {
    writeFileSync(join(root, '.env'), [
      'OPENAI_API_KEY="file-secret"',
      'OPENAI_BASE_URL=https://api.example.com/v1 # endpoint',
      'export EVAL_MODEL=example-evaluator',
      '',
    ].join('\n'));
    const environment = loadEnvironment('', { OPENAI_API_KEY: 'shell-secret' }, root);
    const api = resolveApiConfig({ environment });
    assert.equal(api.apiKey, 'shell-secret');
    assert.equal(api.apiBase, 'https://api.example.com/v1');
    assert.equal(environment.EVAL_MODEL, 'example-evaluator');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Codex uses the shared key and configurable Responses endpoint', () => {
  const argumentsList = codexProviderArgs({ provider: 'api' }, {
    OPENAI_API_KEY: 'private-test-token',
    OPENAI_BASE_URL: 'https://api.example.com/v1/',
    EVAL_MODEL: 'custom-evaluator',
  });
  assert.deepEqual(argumentsList.slice(0, 2), ['-m', 'custom-evaluator']);
  assert.ok(argumentsList.includes('model_providers.benchmark.env_key="OPENAI_API_KEY"'));
  assert.ok(argumentsList.includes('model_providers.benchmark.base_url="https://api.example.com/v1"'));
  assert.ok(argumentsList.includes('model_providers.benchmark.wire_api="responses"'));
  assert.ok(!argumentsList.join(' ').includes('private-test-token'));
  assert.ok(!argumentsList.some((argument) => argument.startsWith('model_context_window=')));
});

test('evaluation dotenv selection and explicit disabling match the Docker launcher', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-eval-env-'));
  try {
    writeFileSync(join(root, '.env'), 'EVAL_MODEL=root-model\n');
    const selected = join(root, 'judge.env');
    writeFileSync(selected, 'EVAL_MODEL=selected-model\n');
    assert.equal(loadEnvironment('', { AUTO_EVAL_ENV_FILE: selected }, root).EVAL_MODEL, 'selected-model');
    assert.equal(loadEnvironment('', { AUTO_EVAL_ENV_FILE: '' }, root).EVAL_MODEL, undefined);
    assert.equal(loadEnvironment('', { AUTO_EVAL_ENV_FILE: selected, EVAL_MODEL: 'shell-model' }, root).EVAL_MODEL, 'shell-model');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('API execution requires credentials but dry-runs and native Codex do not', () => {
  assert.throws(() => codexProviderArgs({ provider: 'api' }, {}), /OPENAI_API_KEY/u);
  assert.doesNotThrow(() => codexProviderArgs({ provider: 'api', dryRun: true }, {}));
  assert.deepEqual(codexProviderArgs({ provider: 'codex', codexModel: 'configured-model' }, {}), [
    '-m', 'configured-model', '-c', 'model_reasoning_effort="high"',
  ]);
  assert.throws(() => codexProviderArgs({ provider: 'unknown' }, {}), /api or codex/u);
});

test('API configuration rejects credentials embedded in URLs and invalid configuration', () => {
  for (const base of ['ftp://example.com', '/relative', 'https://user:secret@example.com', 'https://example.com?key=secret']) {
    assert.throws(() => resolveApiConfig({ apiBase: base, environment: {}, requireKey: false }), /OPENAI_BASE_URL/u);
  }
  assert.throws(() => resolveApiConfig({ apiKeyEnv: 'INVALID.KEY', environment: {} }), /environment variable/u);
  assert.throws(() => codexProviderArgs({ reasoning: 'invalid' }, {}), /REASONING_EFFORT/u);
});
