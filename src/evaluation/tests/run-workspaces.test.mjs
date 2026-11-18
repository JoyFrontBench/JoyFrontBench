import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveWorkspaceTarget } from '../scripts/lib/run-workspaces.mjs';

test('resolveWorkspaceTarget prefers existing dist output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'front-auto-eval-workspace-'));
  mkdirSync(join(directory, 'dist'), { recursive: true });
  writeFileSync(join(directory, 'dist/demo.html'), '<!doctype html>');

  try {
    const target = resolveWorkspaceTarget(directory);
    assert.equal(target.mode, 'static');
    assert.equal(target.entry, 'demo.html');
    assert.equal(target.urlPath, '/demo.html');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resolveWorkspaceTarget marks dependency-backed dev servers for install', () => {
  const directory = mkdtempSync(join(tmpdir(), 'front-auto-eval-dev-'));
  writeFileSync(join(directory, 'index.html'), '<script type="module" src="/src.tsx"></script>');
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ scripts: { dev: 'vite' } })}\n`,
  );

  try {
    const target = resolveWorkspaceTarget(directory);
    assert.equal(target.mode, 'dev');
    assert.equal(target.needsInstall, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
