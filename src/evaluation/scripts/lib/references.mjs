import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { dataRoot } from './config.mjs';

export const bundledReferencesRoot = join(dataRoot, 'references');
export const visualReferenceKind = 'frontend-visual-reference-set';
export const visualReferenceProtocol = 'frozen-visual';
export const liveReferenceProtocol = 'live-workspace';
const ignoredDirectories = new Set([
  '.git', 'node_modules', '.wrangler', '.next', '.vite', '.cache',
  'coverage', 'playwright-report', 'test-results',
]);
const imagePattern = /^images\/[a-z0-9][a-z0-9_-]*\.png$/u;
const rootFiles = new Set(['manifest.json', 'README.md']);

export function snapshotReference(directory, { visualOnly = false } = {}) {
  const files = Object.create(null);
  function visit(current, prefix = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ))) {
      if (!visualOnly && (ignoredDirectories.has(entry.name) || entry.name === '.DS_Store'
        || entry.name.endsWith('.tsbuildinfo'))) continue;
      const path = join(current, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Reference symlink is not allowed: ${key}`);
      if (entry.isDirectory()) {
        if (visualOnly && key !== 'images') throw new Error(`Source/runtime directory is forbidden in visual references: ${key}`);
        visit(path, key);
      } else if (entry.isFile()) {
        if (visualOnly && key !== 'scenes.json' && !imagePattern.test(key)) {
          throw new Error(`Only PNG frames and scenes.json are allowed in visual references: ${key}`);
        }
        files[key] = readFileSync(path);
      } else throw new Error(`Unsupported reference file: ${key}`);
    }
  }
  visit(directory);
  return { files };
}

export function sameReferenceSnapshot(left, right) {
  return sameList(Object.keys(left.files), Object.keys(right.files))
    && Object.keys(left.files).every((path) => left.files[path].equals(right.files[path]));
}

function stringList(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === 'string' && item.trim().length > 0)
    && new Set(value).size === value.length;
}

function sameList(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function readReferenceManifest(root) {
  const path = join(root, 'manifest.json');
  if (lstatSync(path).isSymbolicLink()) throw new Error('Reference manifest must not be a symlink.');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.schema_version !== 2 || manifest.kind !== visualReferenceKind
    || manifest.protocol !== visualReferenceProtocol
    || !/^[a-z0-9][a-z0-9-]*$/u.test(manifest.id || '')
    || !Array.isArray(manifest.questions) || !manifest.questions.length) {
    throw new Error(`Invalid visual reference manifest: ${path}`);
  }
  const ids = new Set();
  for (const question of manifest.questions) {
    if (!question || !/^[a-z0-9][a-z0-9_-]*$/u.test(question.id || '') || ids.has(question.id)
      || !Number.isInteger(question.number) || question.number < 1
      || question.usage !== 'pairwise' || question.entry !== 'scenes.json'
      || !stringList(question.task_ids) || !stringList(question.criterion_ids)
      || !Number.isInteger(question.scene_count) || question.scene_count < 1
      || !Number.isInteger(question.frame_count) || question.frame_count < question.scene_count) {
      throw new Error('Invalid or duplicate visual reference question.');
    }
    ids.add(question.id);
  }
  return { manifest };
}

function validateDataset(manifest, repository) {
  const groups = repository.groups.filter((group) => group.requirements.some((item) => item.judgeMode === 'pairwise_gsb'));
  if (manifest.questions.length !== groups.length) throw new Error('Pairwise reference question coverage mismatch.');
  for (const group of groups) {
    const question = manifest.questions.find((item) => item.id === group.id);
    const requirements = group.requirements.filter((item) => item.judgeMode === 'pairwise_gsb');
    if (!question || question.number !== group.number
      || !sameList(question.task_ids, requirements.map((item) => String(item.taskId)))
      || !sameList(question.criterion_ids, requirements.flatMap((item) => item.criterionIds))) {
      throw new Error(`Reference question mapping mismatch: ${group.id}`);
    }
  }
}

export function readVisualScenes(directory, question) {
  const scenes = JSON.parse(readFileSync(join(directory, 'scenes.json')));
  if (scenes.schema_version !== 1 || scenes.protocol !== visualReferenceProtocol
    || scenes.question_id !== question.id || !sameList(scenes.task_ids, question.task_ids)
    || !Array.isArray(scenes.scenes) || scenes.scenes.length !== question.scene_count
    || typeof scenes.capture?.browser !== 'string' || !scenes.capture.browser
    || !scenes.capture.locale || !scenes.capture.timezone) throw new Error(`Invalid visual scene bundle: ${question.id}`);
  const sceneIds = new Set();
  const paths = new Set();
  const coverage = new Set();
  for (const scene of scenes.scenes) {
    if (!/^[a-z0-9][a-z0-9_-]*$/u.test(scene.id || '') || sceneIds.has(scene.id)
      || typeof scene.title !== 'string' || !scene.title.trim()
      || !stringList(scene.steps) || !stringList(scene.criterion_ids)
      || scene.criterion_ids.some((criterion) => !question.criterion_ids.includes(criterion))
      || !Number.isInteger(scene.viewport?.width) || scene.viewport.width < 1
      || !Number.isInteger(scene.viewport?.height) || scene.viewport.height < 1
      || scene.device_scale_factor !== 1 || typeof scene.full_page !== 'boolean'
      || !['light', 'dark'].includes(scene.color_scheme)
      || !['reduce', 'no-preference'].includes(scene.reduced_motion)
      || !Array.isArray(scene.frames) || !scene.frames.length) throw new Error(`Invalid visual scene: ${question.id}/${scene.id}`);
    sceneIds.add(scene.id);
    for (const criterion of scene.criterion_ids) coverage.add(criterion);
    let previousTime = -1;
    for (const frame of scene.frames) {
      if (!imagePattern.test(frame.path || '') || paths.has(frame.path)
        || !Number.isInteger(frame.elapsed_ms) || frame.elapsed_ms < 0 || frame.elapsed_ms < previousTime) {
        throw new Error(`Invalid visual frame: ${question.id}/${frame.path}`);
      }
      const image = readFileSync(join(directory, frame.path));
      if (image.length < 24 || !image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        || image.toString('ascii', 12, 16) !== 'IHDR' || image.readUInt32BE(16) !== scene.viewport.width
        || (scene.full_page ? image.readUInt32BE(20) < scene.viewport.height : image.readUInt32BE(20) !== scene.viewport.height)) {
        throw new Error(`Invalid PNG frame or viewport dimensions: ${question.id}/${frame.path}`);
      }
      previousTime = frame.elapsed_ms;
      paths.add(frame.path);
    }
  }
  if (paths.size !== question.frame_count
    || !sameList([...coverage], question.criterion_ids)) throw new Error(`Incomplete visual scene coverage: ${question.id}`);
  return scenes;
}

function verifyQuestion(root, question) {
  const directory = join(root, question.id);
  if (lstatSync(directory).isSymbolicLink()) throw new Error(`Reference symlink is not allowed: ${question.id}`);
  const actual = snapshotReference(directory, { visualOnly: true });
  const scenes = readVisualScenes(directory, question);
  const expected = ['scenes.json', ...scenes.scenes.flatMap((scene) => scene.frames.map((frame) => frame.path))];
  if (!sameList(Object.keys(actual.files), expected)) {
    throw new Error(`Reference file inventory mismatch for ${question.id}.`);
  }
  return scenes;
}

export function verifyReferenceSet(root, repository) {
  const result = readReferenceManifest(root);
  validateDataset(result.manifest, repository);
  const ids = new Set(result.manifest.questions.map((question) => question.id));
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (entry.isDirectory() ? !ids.has(entry.name) : !rootFiles.has(entry.name))) {
      throw new Error(`Unexpected visual reference entry: ${entry.name}`);
    }
  }
  for (const question of result.manifest.questions) verifyQuestion(root, question);
  return result;
}

export function defaultReferenceRoot(promptsRoot, repository) {
  const candidates = [
    join(resolve(promptsRoot), 'references'),
    join(dirname(resolve(promptsRoot)), 'references'),
    bundledReferencesRoot,
  ];
  for (const root of new Set(candidates)) {
    if (!existsSync(join(root, 'manifest.json'))) continue;
    const { manifest } = readReferenceManifest(root);
    try {
      validateDataset(manifest, repository);
      return root;
    } catch {
      continue;
    }
  }
  return '';
}

function manifestRoot(directory) {
  let current = resolve(directory);
  while (dirname(current) !== current) {
    const path = join(current, 'manifest.json');
    if (existsSync(path)) {
      const candidate = JSON.parse(readFileSync(path, 'utf8'));
      if (candidate.kind === visualReferenceKind) return current;
    }
    current = dirname(current);
  }
  return '';
}

export function resolveVisualReferenceTarget(inputPath, questionId) {
  const path = resolve(inputPath);
  if (!existsSync(path)) return null;
  const root = manifestRoot(lstatSync(path).isDirectory() ? path : dirname(path));
  if (!root) return null;
  const { manifest } = readReferenceManifest(root);
  const question = manifest.questions.find((item) => item.id === questionId);
  if (!question) throw new Error(`No visual reference for question: ${questionId}`);
  const directory = join(root, question.id);
  const entryPath = join(directory, 'scenes.json');
  if (![root, directory, entryPath].some((candidate) => resolve(candidate) === path)) {
    throw new Error('Select a visual reference set, question directory, or scenes.json; not an individual image.');
  }
  const scenes = verifyQuestion(root, question);
  return { mode: 'visual', workspacePath: directory, root: directory, entry: 'scenes.json', entryPath, questionId, scenes };
}

export function referenceIdentity(target, group, repository) {
  if (!target) return null;
  if (target.mode !== 'visual') {
    const bundledRelative = relative(resolve(bundledReferencesRoot), realpathSync(target.workspacePath));
    if (bundledRelative !== '..' && !bundledRelative.startsWith('../') && !isAbsolute(bundledRelative)) {
      throw new Error('Bundled references are visual evidence, not runnable workspaces.');
    }
    return {
      kind: 'custom', protocol: liveReferenceProtocol, question_id: group.id,
      entry: target.entry, mode: target.mode,
    };
  }
  const root = manifestRoot(target.workspacePath);
  if (!root) throw new Error('Visual reference manifest is missing.');
  const { manifest } = readReferenceManifest(root);
  validateDataset(manifest, repository);
  const question = manifest.questions.find((item) => item.id === group.id);
  if (!question) throw new Error(`No visual reference for question: ${group.id}`);
  verifyQuestion(root, question);
  if (realpathSync(join(root, question.id, question.entry)) !== realpathSync(target.entryPath)) {
    throw new Error(`Reference entrypoint differs from the frozen manifest: ${group.id}`);
  }
  const bundled = existsSync(bundledReferencesRoot)
    && realpathSync(root) === realpathSync(bundledReferencesRoot);
  return {
    kind: bundled ? 'bundled' : 'custom', protocol: manifest.protocol, mode: 'visual',
    set_id: manifest.id, question_id: question.id, entry: question.entry,
    scene_count: question.scene_count, frame_count: question.frame_count,
  };
}

export function summarizeReferenceCohort(runs) {
  const compared = runs.filter((run) => run.tasks?.some((task) => task.judge_mode === 'pairwise_gsb'));
  if (!compared.length) return { kind: 'not-used' };
  const kinds = new Set(compared.map((run) => run.reference?.kind || 'legacy-unversioned'));
  if (kinds.size !== 1) throw new Error('Cannot aggregate bundled, custom, and unversioned references together.');
  const kind = [...kinds][0];
  if (kind === 'legacy-unversioned') return { kind };
  if (!['bundled', 'custom'].includes(kind)) throw new Error('Unknown reference kind.');
  const protocols = new Set(compared.map((run) => run.reference.protocol || liveReferenceProtocol));
  if (protocols.size !== 1) throw new Error('Cannot aggregate live-workspace and frozen-visual reference protocols.');
  const protocol = [...protocols][0];
  const signatures = new Map();
  const sets = new Set();
  for (const run of compared) {
    const reference = run.reference;
    if (!reference.entry) throw new Error('Missing reference entry.');
    const signature = JSON.stringify([
      reference.set_id || '', reference.entry, reference.mode || '',
      reference.scene_count ?? null, reference.frame_count ?? null,
    ]);
    if (signatures.has(run.question_id) && signatures.get(run.question_id) !== signature) {
      throw new Error(`Cannot aggregate different reference configurations for ${run.question_id}.`);
    }
    signatures.set(run.question_id, signature);
    if (kind === 'bundled') sets.add(reference.set_id);
  }
  if (sets.size > 1) throw new Error('Cannot aggregate different bundled reference sets.');
  if (kind === 'bundled') {
    const { set_id: setId } = compared[0].reference;
    if (!setId) throw new Error('Incomplete bundled reference identity.');
    return { kind, protocol, set_id: setId };
  }
  return { kind, protocol, official_eligible: false };
}
