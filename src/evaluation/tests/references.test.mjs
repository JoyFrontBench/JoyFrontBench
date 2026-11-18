import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { mergeAuthoritativeResult, resolveBenchmarkWorkspace, runPipeline } from '../scripts/lib/pipeline.mjs';
import { dataRoot, parseCommandArgs, repositoryRoot } from '../scripts/lib/config.mjs';
import { buildBatchPlan } from '../scripts/lib/batch.mjs';
import { parsePromptGroups } from '../scripts/lib/tasks.mjs';
import {
  bundledReferencesRoot, defaultReferenceRoot, liveReferenceProtocol, readReferenceManifest, referenceIdentity,
  resolveVisualReferenceTarget, sameReferenceSnapshot, snapshotReference,
  summarizeReferenceCohort, verifyReferenceSet, visualReferenceKind, visualReferenceProtocol,
} from '../scripts/lib/references.mjs';
import { writePromptRepository } from './helpers/prompt-repository.mjs';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'front-visual-references-'));
  const prompts = join(root, 'prompts');
  const references = join(root, 'references');
  writePromptRepository(prompts, [{
    number: 1, id: 'sample_1', categories: ['test'], prompt: 'Build an iPhone page.',
    tasks: [{ task_id: '1', judge_mode: 'pairwise_gsb', task: 'Compare', criteria: ['Compare both pages'] }],
  }]);
  const directory = join(references, 'sample_1');
  mkdirSync(join(directory, 'images'), { recursive: true });
  writeFileSync(join(directory, 'images/initial-01.png'), pixel);
  const scenes = {
    schema_version: 1, protocol: visualReferenceProtocol, question_id: 'sample_1', task_ids: ['1'],
    capture: { browser: 'test', locale: 'en-US', timezone: 'UTC' },
    scenes: [{
      id: 'initial', title: 'Initial view', steps: ['Open with fresh storage.'], criterion_ids: ['1.1'],
      viewport: { width: 1, height: 1 }, device_scale_factor: 1, full_page: false,
      color_scheme: 'light', reduced_motion: 'no-preference',
      frames: [{ path: 'images/initial-01.png', elapsed_ms: 0 }],
    }],
  };
  writeFileSync(join(directory, 'scenes.json'), JSON.stringify(scenes));
  const repository = parsePromptGroups(prompts);
  const manifest = {
    schema_version: 2, kind: visualReferenceKind, protocol: visualReferenceProtocol,
    id: 'test-visual-references',
    questions: [{
      id: 'sample_1', number: 1, usage: 'pairwise', entry: 'scenes.json',
      task_ids: ['1'], criterion_ids: ['1.1'], scene_count: 1, frame_count: 1,
    }],
  };
  const save = () => writeFileSync(join(references, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  save();
  return { root, prompts, references, directory, repository, manifest, scenes, save, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('reference protocol names omit iteration suffixes', () => {
  assert.equal(visualReferenceProtocol, 'frozen-visual');
  assert.equal(liveReferenceProtocol, 'live-workspace');
  const { manifest } = verifyReferenceSet(bundledReferencesRoot, parsePromptGroups(dataRoot));
  assert.equal(manifest.protocol, visualReferenceProtocol);
  const cohort = summarizeReferenceCohort([comparedRun('custom', { protocol: undefined })]);
  assert.equal(cohort.protocol, liveReferenceProtocol);
});

test('reference discovery prefers the matching bundle inside the data directory', () => {
  const setup = fixture();
  try {
    const nestedReferences = join(setup.prompts, 'references');
    cpSync(setup.references, nestedReferences, { recursive: true });
    assert.equal(defaultReferenceRoot(setup.prompts, setup.repository), nestedReferences);
    writeFileSync(join(nestedReferences, 'manifest.json'), JSON.stringify({
      ...setup.manifest, questions: [{ ...setup.manifest.questions[0], task_ids: ['2'] }],
    }));
    assert.equal(defaultReferenceRoot(setup.prompts, setup.repository), setup.references);
  } finally { setup.cleanup(); }
});

test('visual manifests verify images, scene metadata, and pairwise mapping without an application', () => {
  const setup = fixture();
  try {
    assert.equal(verifyReferenceSet(setup.references, setup.repository).manifest.questions.length, 1);
    assert.equal(defaultReferenceRoot(setup.prompts, setup.repository), setup.references);
    for (const selection of [setup.references, setup.directory, join(setup.directory, 'scenes.json')]) {
      const target = resolveVisualReferenceTarget(selection, 'sample_1');
      assert.equal(target.mode, 'visual');
      const identity = referenceIdentity(target, setup.repository.groups[0], setup.repository);
      assert.equal(identity.kind, 'custom');
      assert.equal(identity.protocol, visualReferenceProtocol);
      assert.equal(identity.frame_count, 1);
    }
    assert.throws(() => resolveVisualReferenceTarget(join(setup.directory, 'images/initial-01.png'), 'sample_1'), /individual image/u);
  } finally { setup.cleanup(); }
});

test('source code, runtime caches, and unrelated directories cannot enter the visual release', () => {
  for (const filename of ['index.html', 'package.json', 'node_modules/cache.js', 'vendor/library.js', 'dist/index.html', '.DS_Store']) {
    const setup = fixture();
    try {
      const path = join(setup.directory, filename);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'not a visual artifact');
      assert.throws(() => verifyReferenceSet(setup.references, setup.repository), /forbidden|Only PNG/u);
    } finally { setup.cleanup(); }
  }
  const setup = fixture();
  try {
    writeFileSync(join(setup.references, 'source.zip'), 'archive');
    assert.throws(() => verifyReferenceSet(setup.references, setup.repository), /Unexpected visual reference entry/u);
  } finally { setup.cleanup(); }
});

test('modified, deleted, extra frames and symlinks fail verification', () => {
  for (const modification of ['modify', 'delete', 'add', 'symlink', 'traversal', 'duplicate', 'mapping']) {
    const setup = fixture();
    try {
      const image = join(setup.directory, 'images/initial-01.png');
      if (modification === 'modify') writeFileSync(image, 'Changed');
      if (modification === 'delete') rmSync(image);
      if (modification === 'add') writeFileSync(join(setup.directory, 'images/extra.png'), pixel);
      if (modification === 'symlink') symlinkSync('/etc/hosts', join(setup.directory, 'images/link.png'));
      if (modification === 'traversal') setup.scenes.scenes[0].frames[0].path = '../escape.png';
      if (modification === 'duplicate') setup.manifest.questions.push(setup.manifest.questions[0]);
      if (modification === 'mapping') setup.manifest.questions[0].task_ids = ['2'];
      writeFileSync(join(setup.directory, 'scenes.json'), JSON.stringify(setup.scenes));
      setup.save();
      assert.throws(() => verifyReferenceSet(setup.references, setup.repository), /inventory|symlink|Invalid|mapping|ENOENT/u);
    } finally { setup.cleanup(); }
  }
});

test('scene dimensions, coverage and sampling times are validated', () => {
  for (const modification of ['dimensions', 'coverage', 'png', 'timing']) {
    const setup = fixture();
    try {
      if (modification === 'dimensions') setup.scenes.scenes[0].viewport.width = 2;
      if (modification === 'coverage') setup.scenes.scenes[0].criterion_ids = ['2.1'];
      if (modification === 'png') writeFileSync(join(setup.directory, 'images/initial-01.png'), '<script>source</script>');
      if (modification === 'timing') setup.scenes.scenes[0].frames[0].elapsed_ms = -1;
      writeFileSync(join(setup.directory, 'scenes.json'), JSON.stringify(setup.scenes));
      setup.save();
      assert.throws(() => verifyReferenceSet(setup.references, setup.repository), /Invalid|coverage/u);
    } finally { setup.cleanup(); }
  }
});

test('batch planning accepts visual reference directories without runnable HTML', () => {
  const setup = fixture();
  try {
    const candidate = join(setup.root, 'candidates/sample_1');
    mkdirSync(candidate, { recursive: true });
    writeFileSync(join(candidate, 'index.html'), '<!doctype html><title>Candidate</title>');
    const entries = buildBatchPlan({
      repository: setup.repository, workspaceRoot: dirname(candidate), benchmarkRoot: setup.references,
      outputRoot: join(setup.root, 'output'), ids: [], repetitions: 1, runId: 'test', workspaceLayout: 'questions',
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].benchmark, setup.directory);
  } finally { setup.cleanup(); }
});

test('a symlink alias cannot compare a live workspace against itself', () => {
  const root = mkdtempSync(join(tmpdir(), 'front-reference-alias-'));
  try {
    const reference = join(root, 'reference');
    mkdirSync(reference);
    writeFileSync(join(reference, 'index.html'), '<!doctype html><title>Reference</title>');
    const candidate = join(root, 'candidate');
    symlinkSync(reference, candidate);
    assert.throws(() => resolveBenchmarkWorkspace({ workspace: candidate, questionId: 'sample_1', benchmark: reference, required: true }), /benchmark_unresolved/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('published collection contains only the 15 pairwise questions and source-free visual evidence', () => {
  const repository = parsePromptGroups(dataRoot);
  const { manifest } = verifyReferenceSet(bundledReferencesRoot, repository);
  assert.equal(manifest.questions.length, 15);
  for (const question of manifest.questions) {
    const group = repository.groups.find((item) => item.id === question.id);
    const scenes = JSON.parse(readFileSync(join(bundledReferencesRoot, question.id, 'scenes.json'), 'utf8'));
    assert.deepEqual(scenes.capture, { browser: 'Google Chrome', locale: 'zh-CN', timezone: 'UTC' });
    assert.equal(Object.hasOwn(scenes, 'selection_policy'), false);
    const snapshot = snapshotReference(join(bundledReferencesRoot, question.id), { visualOnly: true });
    assert.equal(Object.keys(snapshot.files).length, question.frame_count + 1);
    const target = resolveVisualReferenceTarget(join(bundledReferencesRoot, group.id), group.id);
    assert.equal(referenceIdentity(target, group, repository).kind, 'bundled');
  }
});

test('pipeline dry-run stages bundled images and tells the evaluator not to start a reference application', async () => {
  const root = mkdtempSync(join(tmpdir(), 'front-visual-pipeline-'));
  try {
    const workspace = join(root, 'candidate');
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'index.html'), '<!doctype html><title>Candidate</title>');
    await runPipeline(parseCommandArgs('eval:pipeline', [
      `--prompts=${dataRoot}`, `--workspace=${workspace}`,
      '--id=frontenjoyai-029', `--output-root=${join(root, 'output')}`, '--dry-run',
    ]));
    const context = JSON.parse(readFileSync(join(root, 'output/pipeline-context.json')));
    const state = JSON.parse(readFileSync(join(root, 'output/pipeline-state.json')));
    assert.equal(state.reference.kind, 'bundled');
    assert.equal(state.reference.protocol, visualReferenceProtocol);
    assert.equal(context.benchmark.target.mode, 'visual');
    assert.ok(sameReferenceSnapshot(
      snapshotReference(context.benchmark.visualEvidence.root, { visualOnly: true }),
      snapshotReference(join(bundledReferencesRoot, 'frontenjoyai-029'), { visualOnly: true }),
    ));
    assert.deepEqual(Object.keys(state.reference).sort(), [
      'entry', 'frame_count', 'kind', 'mode', 'protocol', 'question_id', 'scene_count', 'set_id',
    ]);
    assert.match(readFileSync(join(root, 'output/logs/initial-prompt.md'), 'utf8'), /严禁尝试启动、安装或查找标杆源码/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pointwise dry-runs do not inspect any reference override', async () => {
  const root = mkdtempSync(join(tmpdir(), 'front-visual-pointwise-'));
  try {
    const workspace = join(root, 'candidate');
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'index.html'), '<!doctype html><title>Candidate</title>');
    await runPipeline(parseCommandArgs('eval:pipeline', [
      `--prompts=${dataRoot}`, `--workspace=${workspace}`,
      '--benchmark=/does-not-exist', '--id=frontenjoyai-005', `--output-root=${join(root, 'output')}`, '--dry-run',
    ]));
    const context = JSON.parse(readFileSync(join(root, 'output/pipeline-context.json')));
    assert.equal(context.benchmark, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('visual comparisons reject missing scenes and non-reference benchmark images', () => {
  const setup = fixture();
  try {
    const group = setup.repository.groups[0];
    const context = {
      question: { id: group.id, number: 1 }, workspace: { path: '/candidate' }, outputRoot: setup.root,
      requirements: group.requirements, benchmark: {
        target: { scenes: setup.scenes }, visualEvidence: { root: setup.directory, protocol: visualReferenceProtocol },
      },
    };
    const result = mergeAuthoritativeResult({ requirementResults: [{
      taskId: '1', judgeMode: 'pairwise_gsb', status: 'completed', gsb: 'G', reason: ['A visible difference.'],
      evidence: { tested: ['/candidate.png'], benchmark: ['/unrelated.png'] },
      comparison_meta: { viewport: '1x1', interaction_path: ['open'], sampled_at: 'loaded', high_priority_dimensions: ['style'], reference_protocol: visualReferenceProtocol, reference_scene_ids: [] },
      criterionResults: [{ criterionId: '1.1', reason: 'Difference', evidence: { tested: ['/candidate.png'], benchmark: ['/unrelated.png'] } }],
    }] }, context);
    const issues = result.requirementResults[0].contractIssues.join('\n');
    assert.match(issues, /冻结 PNG/u);
    assert.match(issues, /缺少参考场景/u);
    assert.equal(result.requirementResults[0].comparison_meta.reference_protocol, visualReferenceProtocol);
  } finally { setup.cleanup(); }
});

function comparedRun(kind, changes = {}) {
  return {
    question_id: 'sample_1', tasks: [{ judge_mode: 'pairwise_gsb' }],
    reference: kind ? {
      kind, entry: 'scenes.json', protocol: visualReferenceProtocol,
      set_id: 'reference-set', mode: 'visual', scene_count: 1, frame_count: 1, ...changes,
    } : null,
  };
}

test('scoring rejects mixed sets, protocols and incompatible per-question configurations', () => {
  for (const runs of [
    [comparedRun('bundled'), comparedRun('custom')],
    [comparedRun('bundled'), comparedRun(null)],
    [comparedRun('bundled'), comparedRun('bundled', { set_id: 'other-references' })],
    [comparedRun('custom'), comparedRun('custom', { entry: 'index.html' })],
    [comparedRun('bundled'), comparedRun('bundled', { protocol: liveReferenceProtocol })],
    [comparedRun('bundled'), comparedRun('bundled', { frame_count: 2 })],
  ]) assert.throws(() => summarizeReferenceCohort(runs), /Cannot aggregate/u);
  assert.equal(summarizeReferenceCohort([comparedRun('custom')]).official_eligible, false);
  assert.equal(summarizeReferenceCohort([comparedRun(null)]).kind, 'legacy-unversioned');
  assert.equal(summarizeReferenceCohort([]).kind, 'not-used');
});

test('reference metadata contains only the scene index needed for evaluation', () => {
  const { manifest } = readReferenceManifest(bundledReferencesRoot);
  assert.deepEqual(Object.keys(manifest).sort(), ['id', 'kind', 'protocol', 'questions', 'schema_version']);
  for (const question of manifest.questions) {
    assert.deepEqual(Object.keys(question).sort(), [
      'criterion_ids', 'entry', 'frame_count', 'id', 'number', 'scene_count', 'task_ids', 'usage',
    ]);
  }
  assert.equal(manifest.questions.reduce((total, question) => total + question.scene_count, 0), 64);
  assert.equal(manifest.questions.reduce((total, question) => total + question.frame_count, 0), 67);
});

test('reference verification works with only an index and images', () => {
  const setup = fixture();
  try {
    const result = spawnSync(process.execPath, [
      join(repositoryRoot, 'src/evaluation/scripts/cli.mjs'), 'references:verify',
      '--root=' + setup.references, '--prompts=' + setup.prompts,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      id: 'test-visual-references', protocol: visualReferenceProtocol,
      questions: 1, pairwise: 1, status: 'verified', scenes: 1, frames: 1,
    });
  } finally { setup.cleanup(); }
});

test('in-memory reference snapshots detect edits, additions and removals directly', () => {
  const setup = fixture();
  try {
    const original = snapshotReference(setup.directory, { visualOnly: true });
    assert.ok(sameReferenceSnapshot(original, snapshotReference(setup.directory, { visualOnly: true })));
    const changed = Buffer.from(pixel);
    changed[changed.length - 1] ^= 1;
    writeFileSync(join(setup.directory, 'images/initial-01.png'), changed);
    assert.equal(sameReferenceSnapshot(original, snapshotReference(setup.directory, { visualOnly: true })), false);
    writeFileSync(join(setup.directory, 'images/initial-01.png'), pixel);
    writeFileSync(join(setup.directory, 'images/extra.png'), pixel);
    assert.equal(sameReferenceSnapshot(original, snapshotReference(setup.directory, { visualOnly: true })), false);
    rmSync(join(setup.directory, 'images/extra.png'));
    rmSync(join(setup.directory, 'images/initial-01.png'));
    assert.equal(sameReferenceSnapshot(original, snapshotReference(setup.directory, { visualOnly: true })), false);
  } finally { setup.cleanup(); }
});

for (const selection of ['original', 'report-copy']) {
  test('evaluation rejects changes to ' + selection + ' reference images', async () => {
    const setup = fixture();
    try {
      const workspace = join(setup.root, 'candidate');
      mkdirSync(workspace);
      writeFileSync(join(workspace, 'index.html'), '<!doctype html><title>Candidate</title>');
      const output = join(setup.root, 'output');
      const image = selection === 'original'
        ? join(setup.directory, 'images/initial-01.png')
        : join(output, 'screenshots/reference/sample_1/images/initial-01.png');
      const executable = join(setup.root, 'fake-evaluator');
      writeFileSync(executable, '#!/usr/bin/env node\n'
        + 'const fs = require("node:fs"); const path = ' + JSON.stringify(image) + ';\n'
        + 'const image = fs.readFileSync(path); image[image.length - 1] ^= 1; fs.writeFileSync(path, image);\n');
      chmodSync(executable, 0o755);
      await assert.rejects(runPipeline(parseCommandArgs('eval:pipeline', [
        '--prompts=' + setup.prompts, '--workspace=' + workspace,
        '--id=sample_1', '--benchmark=' + setup.references,
        '--output-root=' + output, '--codex-bin=' + executable, '--provider=codex',
      ])), /Reference content changed/u);
    } finally { setup.cleanup(); }
  });
}
