import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function htmlFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort();
}

function htmlEntry(files) {
  if (files.includes('index.html')) return 'index.html';
  return files[0] || '';
}

function urlPathForHtml(file) {
  return file === 'index.html' ? '/' : `/${encodeURIComponent(file)}`;
}

export function resolveWorkspaceTarget(inputWorkspacePath) {
  const workspacePath = resolve(inputWorkspacePath);
  if (!existsSync(workspacePath)) {
    return {
      mode: 'unlaunchable',
      workspacePath,
      reason: 'workspace directory does not exist',
    };
  }

  const distPath = join(workspacePath, 'dist');
  const distHtml = htmlFiles(distPath);
  if (distHtml.length) {
    const entry = htmlEntry(distHtml);
    return {
      mode: 'static',
      workspacePath,
      root: distPath,
      entry,
      urlPath: urlPathForHtml(entry),
      reason: 'using existing dist output',
    };
  }

  const rootHtml = htmlFiles(workspacePath);
  const rootEntry = htmlEntry(rootHtml);
  const packagePath = join(workspacePath, 'package.json');
  let packageJson = null;
  if (existsSync(packagePath)) {
    try {
      packageJson = readJson(packagePath);
    } catch {}
  }
  const devScript = String(packageJson?.scripts?.dev || '').trim();
  const localVite = join(workspacePath, 'node_modules/.bin/vite');
  const hasNodeModules = existsSync(join(workspacePath, 'node_modules'));

  if (devScript && /\b(?:serve|http-server)\b/u.test(devScript) && rootEntry) {
    return {
      mode: 'static',
      workspacePath,
      root: workspacePath,
      entry: rootEntry,
      urlPath: urlPathForHtml(rootEntry),
      reason: `using static root instead of dev script: ${devScript}`,
    };
  }
  if (devScript || existsSync(localVite)) {
    const usesOnlyRuntimeCommand = /^(?:node|deno|bun|python3?)\s/u.test(devScript);
    return {
      mode: 'dev',
      workspacePath,
      root: workspacePath,
      entry: rootEntry || 'index.html',
      urlPath: rootEntry ? urlPathForHtml(rootEntry) : '/',
      devScript: devScript || 'vite',
      needsInstall: Boolean(devScript && !hasNodeModules && !usesOnlyRuntimeCommand),
      reason: devScript
        ? `using package dev script: ${devScript}`
        : 'using workspace-local Vite',
    };
  }
  if (rootEntry) {
    return {
      mode: 'static',
      workspacePath,
      root: workspacePath,
      entry: rootEntry,
      urlPath: urlPathForHtml(rootEntry),
      reason: 'using standalone workspace HTML',
    };
  }
  return {
    mode: 'unlaunchable',
    workspacePath,
    reason: 'no dist HTML, dev server, or standalone HTML found',
  };
}
