import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, unlink, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildManifest, verifyManifest, isFunctionalPath, validRelativePath } from './source-manifest.mjs';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('./source-manifest.mjs', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
async function put(root, filename, content = filename) {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(path.join(root, filename), content);
}
async function git(root, ...args) {
  return execute('git', [
    '-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(root, 'no-hooks')}`,
    ...args,
  ], { cwd: root, windowsHide: true });
}
async function commit(root) {
  await git(root, 'add', '--all');
  await git(root, 'commit', '-q', '-m', 'synthetic fixture');
}
async function repository(t, files = { 'Cargo.toml': '[package]\n', 'src/main.rs': 'fn main() {}\n' }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '-q');
  for (const [filename, content] of Object.entries(files)) await put(root, filename, content);
  await commit(root);
  return root;
}

test('deterministic manifest includes functional source, locks, build scripts and CI', async t => {
  const root = await repository(t, {
    'Cargo.toml': 'crate', 'Cargo.lock': 'lock', 'rust-toolchain.toml': 'toolchain',
    'src/main.rs': 'rust', 'tests/contract.rs': 'test', 'fixtures/synthetic.json': '{}',
    'scripts/build.mjs': 'build', 'scripts/build/package.mjs': 'nested build script',
    'src/build/logic.rs': 'source module', '.github/workflows/ci.yml': 'ci',
    'web/src/index.ts': 'web', 'site/worker/index.js': 'server',
    'browser-extension/manifest.json': '{}', 'browser-extension/popup.js': 'extension',
    'shared/contract.ts': 'contract', 'package.json': '{}', 'pnpm-lock.yaml': 'lock',
    'vite.config.ts': 'config', 'docs/notes.md': 'documentation',
    'README.md': 'readme', '.openai/hosting.json': 'private deployment identity',
    'reports/private.json': 'runtime data', 'web/dist/index.html': 'generated',
  });
  const first = await buildManifest(root);
  assert.deepEqual(await buildManifest(root), first);
  const paths = first.files.map(file => file.path);
  for (const included of ['Cargo.lock', 'rust-toolchain.toml', '.github/workflows/ci.yml', 'site/worker/index.js', 'shared/contract.ts', 'pnpm-lock.yaml', 'scripts/build/package.mjs', 'src/build/logic.rs', 'browser-extension/manifest.json', 'browser-extension/popup.js']) assert.ok(paths.includes(included));
  for (const excluded of ['docs/notes.md', 'README.md', '.openai/hosting.json', 'reports/private.json', 'web/dist/index.html']) assert.ok(!paths.includes(excluded));
  assert.equal(first.files.find(file => file.path === 'src/main.rs').sha256, hash('rust'));
  assert.equal(first.functional_source_sha256, hash(JSON.stringify(first.files)));
  const cli = await execute(process.execPath, [script], { cwd: root });
  assert.deepEqual(JSON.parse(cli.stdout), first);
});

test('rejects a directory outside Git and a repository without a commit', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-no-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(buildManifest(root), { code: 'git_repository_required' });
  await git(root, 'init', '-q');
  await assert.rejects(buildManifest(root), { code: 'committed_head_required' });
});

test('rejects unstaged functional edits', async t => {
  const root = await repository(t);
  await put(root, 'src/main.rs', 'changed');
  await assert.rejects(buildManifest(root), { code: 'functional_source_dirty' });
});

test('rejects staged edits even when the worktree is restored to HEAD content', async t => {
  const root = await repository(t);
  await put(root, 'src/main.rs', 'staged');
  await git(root, 'add', 'src/main.rs');
  await put(root, 'src/main.rs', 'fn main() {}\n');
  await assert.rejects(buildManifest(root), { code: 'functional_source_dirty' });
});

test('rejects new source including ignored functional files without scanning ignored artifacts', async t => {
  const root = await repository(t, {
    'Cargo.toml': 'crate', 'src/main.rs': 'main', '.gitignore': 'src/ignored.rs\nweb/node_modules/\ntarget/\n',
  });
  await put(root, 'src/ignored.rs', 'new source');
  await put(root, 'web/node_modules/dependency/index.js', 'dependency cache');
  await put(root, 'target/large/artifact', 'generated');
  await assert.rejects(buildManifest(root), { code: 'untracked_functional_source' });
  await unlink(path.join(root, 'src/ignored.rs'));
  await buildManifest(root);
  await put(root, 'shared/new.ts', 'new contract');
  await assert.rejects(buildManifest(root), { code: 'untracked_functional_source' });
  await unlink(path.join(root, 'shared/new.ts'));
  await put(root, 'src/build/new.rs', 'new source module');
  await assert.rejects(buildManifest(root), { code: 'untracked_functional_source' });
});

test('permits documentation and private identity changes; parity ignores metadata-only commit SHA', async t => {
  const root = await repository(t, {
    'Cargo.toml': 'crate', 'src/main.rs': 'main',
    '.openai/hosting.json': 'first private id', 'docs/delivery.md': 'docs',
  });
  const original = await buildManifest(root);
  await put(root, '.openai/hosting.json', 'different private id');
  await put(root, 'docs/delivery.md', 'updated documentation');
  await put(root, 'docs/untracked.md', 'new docs');
  assert.equal((await buildManifest(root)).functional_source_sha256, original.functional_source_sha256);
  await commit(root);
  const result = await verifyManifest(original, root);
  assert.equal(result.status, 'verified');
  assert.notEqual(result.current_git_commit, result.manifest_source_git_commit);
  const manifestFile = path.join(root, 'expected-manifest.json');
  await writeFile(manifestFile, JSON.stringify(original));
  const cli = await execute(process.execPath, [script, '--verify', manifestFile], { cwd: root });
  assert.equal(JSON.parse(cli.stdout).status, 'verified');
});

for (const change of ['modified', 'deleted', 'added']) {
  test(`verify rejects committed ${change} functional files`, async t => {
    const root = await repository(t);
    const expected = await buildManifest(root);
    if (change === 'modified') await put(root, 'src/main.rs', 'new main');
    if (change === 'deleted') await unlink(path.join(root, 'src/main.rs'));
    if (change === 'added') await put(root, 'web/index.html', '<html>new source</html>');
    await commit(root);
    await assert.rejects(verifyManifest(expected, root), { code: 'manifest_mismatch' });
  });
}

test('newline paths are NUL-safe and JSON escaped', { skip: process.platform === 'win32' }, async t => {
  const root = await repository(t, { 'Cargo.toml': 'crate', 'src/a\nb.rs': 'newline file' });
  const report = await buildManifest(root);
  assert.ok(report.files.some(file => file.path === 'src/a\nb.rs'));
  assert.equal(JSON.parse(JSON.stringify(report)).files.length, 2);
  await put(root, 'src/new\nfile.rs', 'untracked');
  await assert.rejects(buildManifest(root), { code: 'untracked_functional_source' });
});

test('rejects tracked symlinks and replacement symlink ancestors', { skip: process.platform === 'win32' }, async t => {
  const root = await repository(t);
  await symlink('main.rs', path.join(root, 'src/alias.rs'));
  await commit(root);
  await assert.rejects(buildManifest(root), { code: 'source_symlink_not_allowed' });
});

test('manifest rejects traversal, absolute, duplicate, unsorted and tampered entries', async t => {
  const root = await repository(t);
  const original = await buildManifest(root);
  for (const invalidPath of ['../secret', '/secret', 'C:/secret', 'src/../secret', 'src//file', './src/file', 'src\\file', 'src/\0file', '.openai/hosting.json']) {
    const value = structuredClone(original);
    value.files[0].path = invalidPath;
    value.functional_source_sha256 = hash(JSON.stringify(value.files));
    await assert.rejects(verifyManifest(value, root), { code: 'invalid_manifest' });
  }
  for (const mutate of [
    value => value.files.push(value.files[0]),
    value => value.files.reverse(),
    value => { value.files[0].sha256 = '0'.repeat(64); },
    value => { value.source_git_commit = 'not a commit'; },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    await assert.rejects(verifyManifest(value, root), { code: 'invalid_manifest' });
  }
});

test('path classification covers build inputs and excludes runtime/private data', () => {
  for (const source of ['Cargo.toml', 'package-lock.json', '.github/workflows/release.yml', 'scripts/source-manifest.mjs', 'web/package.json', 'shared/schema.ts', 'worker/index.ts']) assert.equal(isFunctionalPath(source), true, source);
  for (const excluded of ['README.md', 'docs/plan.md', 'reports/private.json', '.openai/hosting.json', 'web/node_modules/foo.js', 'site/.env.local', 'site/dist/app.js', 'target/bin']) assert.equal(isFunctionalPath(excluded), false, excluded);
  assert.equal(validRelativePath('src/new\nline.rs'), true);
  assert.equal(validRelativePath('../src/main.rs'), false);
});
