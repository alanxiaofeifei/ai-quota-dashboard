#!/usr/bin/env node
// Explicit local filesystem sync. Never invokes Git writes or network commands.
import { lstat, mkdir, readdir, readFile, copyFile, unlink, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorktreeManifest, verifyWorktreeManifest, isFunctionalPath } from './source-manifest.mjs';
const source = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const protectedFiles = new Set(['README.md','core-backup.json','wrangler.personal.jsonc','docs/PERSONAL.md']);
const skipped = new Set(['.git','node_modules','legacy','dist','target','.wrangler','coverage','__pycache__','.openai','reports','profiles']);
function managed(p) {
 if(protectedFiles.has(p) || p.split('/').some(s=>s.startsWith('.env')||s.startsWith('.dev.vars'))) return false;
 return isFunctionalPath(p) || p==='AGENTS.md' || p.startsWith('docs/');
}
async function files(root,relative='') {
 const output=[];
 for(const e of await readdir(path.join(root,relative),{withFileTypes:true})) {
  if(skipped.has(e.name) || e.name.startsWith('.env') || e.name.startsWith('.dev.vars')) continue;
  const p=relative?`${relative}/${e.name}`:e.name;
  if(e.isSymbolicLink()) {if(managed(p)||e.isDirectory()||['server','web','shared','scripts','docs','worker','migrations','.github','tests'].includes(p))throw new Error('Managed symlinks are not allowed');continue}
  if(e.isDirectory()) output.push(...await files(root,p));
  else if(e.isFile() && managed(p)) output.push(p);
 }
 return output;
}
async function safeParent(root,relative) {
 let current=root;
 for(const part of relative.split('/').slice(0,-1)) {
  current=path.join(current,part);
  try {const s=await lstat(current);if(s.isSymbolicLink() || !s.isDirectory())throw new Error('Unsafe target path')}
  catch(e){if(e.code!=='ENOENT')throw e;await mkdir(current)}
 }
 try{const s=await lstat(path.join(root,relative));if(!s.isFile()||s.isSymbolicLink())throw new Error('Unsafe target file')}catch(e){if(e.code!=='ENOENT')throw e}
}
export async function syncPersonal(target,from=source) {
 const src=await realpath(from),dest=await realpath(target);
 if(src===dest || dest.startsWith(`${src}${path.sep}`) || src.startsWith(`${dest}${path.sep}`))throw new Error('Source and target must be separate checkouts');
 // Validate all source paths, including manifest symlink checks, before mutation.
 const manifest=await buildWorktreeManifest(src);const desired=await files(src),existing=await files(dest);const wanted=new Set(desired);
 for(const p of [...desired,...existing,'core-backup.json'])await safeParent(dest,p);
 for(const p of existing)if(!wanted.has(p))await unlink(path.join(dest,p));
 for(const p of desired)await copyFile(path.join(src,p),path.join(dest,p));
 await writeFile(path.join(dest,'core-backup.json'),JSON.stringify(manifest,null,2)+'\n');
 const result=await verifyWorktreeManifest(JSON.parse(await readFile(path.join(dest,'core-backup.json'),'utf8')),dest);
 return {...result,copied:desired.length};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.length!==3){console.error('Usage: node scripts/sync-personal.mjs /path/to/personal-checkout');process.exitCode=1}
 else syncPersonal(process.argv[2]).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{console.error('sync_failed: Check separate Git checkouts, managed regular files, and source parity.');process.exitCode=1});
}
