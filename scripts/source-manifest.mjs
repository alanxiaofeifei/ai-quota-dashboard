#!/usr/bin/env node
// Offline release provenance. No remote access, credentials, or Git mutations.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const decoder = new TextDecoder('utf-8', { fatal: true });
const functionalRoots = [
  'src', 'crates', 'tests', 'fixtures', 'web', 'site', 'shared', 'scripts',
  '.github', 'app', 'worker', 'db', 'drizzle', 'public',
];
const runtimeDirectories = new Set([
  '.git', 'node_modules', '.sites-runtime', '.wrangler', '.cache', '.next',
  '.nuxt', '.output', '__pycache__',
]);
const generatedDirectories = new Set([
  'target', 'dist', 'build', 'out', 'outputs', 'reports', 'coverage', 'generated-data',
]);
const generatedContainers = ['web', 'site', 'app', 'worker', 'public', 'shared'];
const generatedScriptDirectories = ['generated-data', 'outputs', 'reports', 'coverage'];
const rootBuildFile = /^(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.?rustfmt\.toml|deny\.toml|build\.rs|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|index\.html|[Mm]akefile|GNUmakefile|[Jj]ustfile|Dockerfile(?:\..+)?|(?:docker-compose|compose)\.ya?ml|\.dockerignore|\.gitignore|\.gitattributes|tsconfig(?:\.[^.]+)?\.json|(?:vite|vitest|next|vinext|webpack|rollup|eslint|postcss|tailwind)\.config\.[cm]?[jt]s|wrangler\.(?:toml|jsonc?))$/;
const messages = {
  git_repository_required: 'Run inside an existing Git worktree.',
  committed_head_required: 'Commit the source before producing a release manifest.',
  git_read_failed: 'Git source inspection failed.',
  invalid_source_path: 'A source path is not a portable relative path.',
  functional_source_dirty: 'Commit or revert staged and unstaged functional source changes.',
  untracked_functional_source: 'Track or remove new functional source before release.',
  source_file_unavailable: 'A tracked functional source file is missing or unreadable.',
  source_symlink_not_allowed: 'Functional source must contain regular files without symlink ancestors.',
  no_functional_source: 'No tracked functional source was found.',
  invalid_manifest: 'The supplied manifest has an invalid structure or digest.',
  manifest_mismatch: 'Current functional source differs from the supplied manifest.',
  invalid_arguments: 'Use source-manifest.mjs [--verify <manifest.json>].',
};

export class ManifestError extends Error {
  constructor(code) {
    super(messages[code]);
    this.name = 'ManifestError';
    this.code = code;
  }
}

function fail(code) { throw new ManifestError(code); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function comparePaths(a, b) { return Buffer.compare(Buffer.from(a), Buffer.from(b)); }

export function validRelativePath(value) {
  return typeof value === 'string' && value.length > 0 &&
    !value.includes('\0') && !value.includes('\\') &&
    !value.startsWith('/') && !/^[a-zA-Z]:/.test(value) &&
    value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

export function isFunctionalPath(relativePath) {
  if (!validRelativePath(relativePath)) return false;
  const parts = relativePath.split('/');
  if (parts.some(part => runtimeDirectories.has(part))) return false;
  if (parts[0] === 'docs' || parts[0] === '.openai') return false;
  if (generatedDirectories.has(parts[0])) return false;
  if (parts.length > 1 && generatedContainers.includes(parts[0]) && generatedDirectories.has(parts[1])) return false;
  if (parts[0] === 'scripts' && generatedScriptDirectories.includes(parts[1])) return false;
  if (parts.some(part => part.startsWith('.env') || part.startsWith('.dev.vars'))) return false;
  return parts.length === 1 ? rootBuildFile.test(parts[0]) : functionalRoots.includes(parts[0]);
}

async function git(cwd, args, code = 'git_read_failed') {
  try {
    const result = await execute('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return result.stdout;
  } catch { fail(code); }
}

function nulPaths(bytes) {
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail('git_read_failed');
  let text;
  try { text = decoder.decode(bytes.subarray(0, -1)); }
  catch { fail('invalid_source_path'); }
  const paths = text.split('\0');
  if (paths.some(p => !validRelativePath(p))) fail('invalid_source_path');
  return paths;
}

async function regularSourceBytes(root, relativePath) {
  if (!validRelativePath(relativePath)) fail('invalid_source_path');
  const parts = relativePath.split('/');
  let current = root;
  try {
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) fail('source_symlink_not_allowed');
      if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
        fail('source_file_unavailable');
      }
    }
    return await readFile(current);
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    fail('source_file_unavailable');
  }
}

function untrackedPathspecs() {
  return [
    ':(top,glob)*',
    ...functionalRoots.map(name => `:(top)${name}`),
    ...[...runtimeDirectories].map(name => `:(glob,exclude)**/${name}/**`),
    ...[...generatedDirectories].map(name => `:(top,glob,exclude)${name}/**`),
    ...generatedContainers.flatMap(container => [...generatedDirectories].map(name => `:(top,glob,exclude)${container}/${name}/**`)),
    ...generatedScriptDirectories.map(name => `:(top,glob,exclude)scripts/${name}/**`),
  ];
}

export async function buildManifest(cwd = process.cwd()) {
  const rootBytes = await git(cwd, ['rev-parse', '--show-toplevel'], 'git_repository_required');
  let root;
  try { root = decoder.decode(rootBytes).replace(/\n$/, ''); }
  catch { fail('invalid_source_path'); }
  const commit = (await git(root, ['rev-parse', '--verify', 'HEAD'], 'committed_head_required')).toString('ascii').trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) fail('committed_head_required');
  const [trackedBytes, stagedBytes, unstagedBytes, untrackedBytes] = await Promise.all([
    git(root, ['ls-files', '--cached', '-z']),
    git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', '--']),
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', '--']),
    // Include ignored source, but avoid traversing dependency and artifact trees.
    git(root, ['ls-files', '--others', '-z', '--', ...untrackedPathspecs()]),
  ]);
  if ([...nulPaths(stagedBytes), ...nulPaths(unstagedBytes)].some(isFunctionalPath)) fail('functional_source_dirty');
  if (nulPaths(untrackedBytes).some(isFunctionalPath)) fail('untracked_functional_source');
  const paths = [...new Set(nulPaths(trackedBytes).filter(isFunctionalPath))].sort(comparePaths);
  if (paths.length === 0) fail('no_functional_source');
  const files = [];
  for (const relativePath of paths) {
    files.push({ path: relativePath, sha256: sha256(await regularSourceBytes(root, relativePath)) });
  }
  return {
    schema_version: 1,
    algorithm: 'sha256',
    source_git_commit: commit,
    functional_source_sha256: sha256(JSON.stringify(files)),
    files,
  };
}

function validateManifest(value) {
  if (!value || typeof value !== 'object' || value.schema_version !== 1 || value.algorithm !== 'sha256' ||
      typeof value.source_git_commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.source_git_commit) ||
      typeof value.functional_source_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.functional_source_sha256) ||
      !Array.isArray(value.files) || value.files.length === 0) fail('invalid_manifest');
  const seen = new Set();
  for (const entry of value.files) {
    if (!entry || typeof entry !== 'object' || !validRelativePath(entry.path) ||
        !isFunctionalPath(entry.path) || typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || seen.has(entry.path) ||
        Object.keys(entry).sort().join(',') !== 'path,sha256') fail('invalid_manifest');
    seen.add(entry.path);
  }
  const files = value.files.map(({ path: filename, sha256: digest }) => ({ path: filename, sha256: digest }));
  if (files.some((entry, i) => i > 0 && comparePaths(files[i - 1].path, entry.path) >= 0) ||
      sha256(JSON.stringify(files)) !== value.functional_source_sha256) fail('invalid_manifest');
  return files;
}

export async function verifyManifest(value, cwd = process.cwd()) {
  const expected = validateManifest(value);
  const current = await buildManifest(cwd);
  if (JSON.stringify(expected) !== JSON.stringify(current.files) ||
      value.functional_source_sha256 !== current.functional_source_sha256) fail('manifest_mismatch');
  return {
    status: 'verified',
    functional_source_sha256: current.functional_source_sha256,
    current_git_commit: current.source_git_commit,
    manifest_source_git_commit: value.source_git_commit ?? null,
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/source-manifest.mjs [--verify <manifest.json>]\nRequires committed, clean functional source; emits JSON to stdout. No network.');
    return;
  }
  if (args.length === 0) {
    console.log(JSON.stringify(await buildManifest(), null, 2));
    return;
  }
  if (args.length !== 2 || args[0] !== '--verify' || !args[1]) fail('invalid_arguments');
  let value;
  try { value = JSON.parse(await readFile(args[1], 'utf8')); }
  catch { fail('invalid_manifest'); }
  console.log(JSON.stringify(await verifyManifest(value), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    if (error instanceof ManifestError) console.error(`${error.code}: ${error.message}`);
    else console.error('source_manifest_failed: Source inspection failed.');
    process.exitCode = 1;
  });
}
