import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {syncPersonal} from './sync-personal.mjs';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'quota-sync-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],{cwd:root,stdio:'pipe'});
 git('init','-q');await writeFile(path.join(root,'package.json'),'{}');git('add','.');git('commit','-qm','synthetic fixture');return root;
}
async function put(root,p,value){await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),value)}
test('syncs new/dirty managed source, removes obsolete source and preserves personal files',async t=>{
 const src=await fixture(t),dest=await fixture(t);
 await put(src,'server/auth.ts','new auth');await put(src,'migrations/0001.sql','new schema');await put(src,'docs/STATUS.md','current');await put(src,'AGENTS.md','rules');await put(src,'README.md','public readme');await put(src,'.dev.vars','synthetic ignored');await put(src,'legacy/main.rs','excluded');
 await put(dest,'web/old.ts','obsolete');
 for(const p of ['README.md','wrangler.personal.jsonc','docs/PERSONAL.md','.dev.vars'])await put(dest,p,`private ${p}`);
 const result=await syncPersonal(dest,src);assert.equal(result.status,'verified');
 for(const p of ['README.md','wrangler.personal.jsonc','docs/PERSONAL.md','.dev.vars'])assert.equal(await readFile(path.join(dest,p),'utf8'),`private ${p}`);
 assert.equal(await readFile(path.join(dest,'server/auth.ts'),'utf8'),'new auth');assert.equal(await readFile(path.join(dest,'AGENTS.md'),'utf8'),'rules');
 await assert.rejects(lstat(path.join(dest,'web/old.ts')));await assert.rejects(lstat(path.join(dest,'legacy/main.rs')));
 assert.equal(JSON.parse(await readFile(path.join(dest,'core-backup.json'),'utf8')).source_mode,'worktree');
});
test('refuses same checkout and target symlink ancestors',async t=>{
 const src=await fixture(t),dest=await fixture(t);await assert.rejects(syncPersonal(src,src));await put(src,'server/auth.ts','code');await symlink(src,path.join(dest,'server'),'dir');await assert.rejects(syncPersonal(dest,src));
});
