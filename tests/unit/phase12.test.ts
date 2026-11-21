import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {database} from './fake-d1';
import {handleApi} from '../../server/api';
import {handleExtension,extensionSummary,syncConfig} from '../../server/extension';
import {overview,snapshotStatement} from '../../server/db';
import {defaultSources,parseSource,type SyncSource} from '../../shared/extension';
import {presets} from '../../browser-extension/presets.mjs';
import type {Env} from '../../worker/index';
const env=():Env=>({AUTH_MODE:'access',DB:database()} as Env);
const request=(path:string,body:unknown,token?:string)=>new Request(`https://quota.test/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:token?`chrome-extension://${'a'.repeat(32)}`:'https://quota.test',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
async function pair(e:Env){const r=await handleApi(request('extension',{action:'pair',name:'Synthetic browser'}),e);const {code}=await r.json() as {code:string};return JSON.parse(atob(code.slice(5).replace(/-/g,'+').replace(/_/g,'/'))).token as string}
async function add(e:Env,token:string,url:string,accountLabel:string){const r=await handleExtension(request('ext/config',{addPage:{url,accountLabel}},token),e);expect(r.status).toBe(201);return (await r.json() as {source:SyncSource}).source}
async function ingest(e:Env,token:string,s:SyncSource,amount:number,status='ok',unit='requests',id='requests'){return handleExtension(request('ext/ingest',{sourceId:s.id,providerId:s.providerId,status,observed_at:new Date().toISOString(),items:status==='ok'?[{id,unit,amount,resetAt:null}]:[]},token),e)}
describe('v1.2 presets and per-account snapshots',()=>{
 it('has enabled validated presets for all known provider pages',()=>{for(const p of presets){const defaults=defaultSources([{id:'p',label:p.name,type:p.type,region:p.id.endsWith('intl')?(p.type==='moonshot'?'ai':'com'):'cn'}]);const source=defaults.find(s=>s.parser===p.parser);expect(source,p.id).toBeDefined();expect(parseSource(source)).toMatchObject({enabled:true,parser:p.parser,accountLabel:'默认账户'});}expect(()=>parseSource({...defaultSources([{id:'p',label:'GLM',type:'glm',region:'cn'}])[0],url:'https://evil.invalid/'})).toThrow();expect(()=>parseSource({...defaultSources([{id:'p',label:'Google',type:'gemini',region:'cn'}])[0],parser:'taught',url:'https://aistudio.google.com/usage?authuser=not-collected@example.invalid'})).toThrow()});
 it('adds two Google accounts without crossing cards, snapshots or official-page links',async()=>{
 const e=env(),token=await pair(e);const a=await add(e,token,'https://aistudio.google.com/usage?authuser=0','Google 个人'),b=await add(e,token,'https://aistudio.google.com/u/1/usage','Google 工作');expect(a.providerId).not.toBe(b.providerId);
 expect((await ingest(e,token,a,42)).status).toBe(200);expect((await ingest(e,token,b,73)).status).toBe(200);
 const rows=(await extensionSummary(e.DB)).providers;expect(rows).toHaveLength(2);expect(rows.find(r=>r.accountLabel==='Google 个人')).toMatchObject({primary:{value:42,unit:'requests'},usageUrl:a.url,source:'extension'});expect(rows.find(r=>r.accountLabel==='Google 工作')).toMatchObject({primary:{value:73,unit:'requests'},usageUrl:b.url});
 expect((await ingest(e,token,a,0,'permission_required')).status).toBe(200);const after=(await extensionSummary(e.DB)).providers;expect(after.find(r=>r.id===a.providerId)).toMatchObject({primary:{value:42,unit:'requests'},reason:'permission_required'});expect(after.find(r=>r.id===b.providerId)?.primary?.value).toBe(73);
 const providers=await overview(e.DB);expect(providers.find(p=>p.id===a.providerId)?.snapshot?.facts.accountLabel).toBe('Google 个人');expect(fetch).not.toHaveBeenCalled();
 await expect(handleExtension(request('ext/config',{sources:[{...a,id:'partial',url:b.url}]},token),e)).rejects.toThrow();
 const bad={...a,id:'other',url:b.url,accountLabel:'Google 工作'};await expect(handleExtension(request('ext/config',{sources:[a,bad]},token),e)).rejects.toThrow();
 });
 it('offers an API-independent OpenRouter page balance and prefers official API account balance when present',async()=>{
 const e=env(),token=await pair(e),s=await add(e,token,'https://openrouter.ai/settings/credits','默认账户');
 await snapshotStatement(e.DB,s.providerId,{source:'api',items:[{id:'account_remaining',label:'account_remaining',amount:null,unit:'USD',resetAt:null},{id:'key_remaining',label:'key_remaining',amount:99,unit:'USD',resetAt:null}],facts:{keyUnlimited:true},observedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),staleAfter:3600},Date.now()).run();
 expect((await extensionSummary(e.DB)).providers[0]).toMatchObject({reason:'management_key_required',primary:{value:null,unit:'USD'}});
 expect((await ingest(e,token,s,8.47,'ok','USD','account_remaining')).status).toBe(200);let p=(await overview(e.DB))[0];expect(p.snapshot?.source).toBe('extension');expect(p.snapshot?.items.map(i=>i.amount)).toEqual([8.47,99]);expect(p.snapshot?.facts.keyUnlimited).toBe(true);expect(p.source).toBe('extension');expect((await extensionSummary(e.DB)).providers[0].reason).toBeNull();
 await snapshotStatement(e.DB,s.providerId,{...p.snapshot!,source:'api',items:[{id:'account_remaining',label:'account_remaining',amount:6.25,unit:'USD',resetAt:null}],observedAt:new Date().toISOString()},Date.now()).run();p=(await overview(e.DB))[0];expect(p.snapshot?.source).toBe('api');expect(p.snapshot?.items[0].amount).toBe(6.25);
 await ingest(e,token,s,0,'timeout');expect((await overview(e.DB))[0].snapshot?.items[0].amount).toBe(6.25);
 });
 it('keeps regional page-only accounts separate and uses valid SiliconFlow international region',async()=>{
 const e=env(),token=await pair(e);const cn=await add(e,token,'https://cloud.siliconflow.cn/account/balance','默认账户'),intl=await add(e,token,'https://cloud.siliconflow.com/account/balance','默认账户');expect(cn.providerId).not.toBe(intl.providerId);const providers=await overview(e.DB);expect(providers.find(p=>p.id===cn.providerId)?.region).toBe('cn');expect(providers.find(p=>p.id===intl.providerId)?.region).toBe('com');
 });
 it('rejects wrong units/unknown metrics and does not convert unreadable values to zero',async()=>{
 const e=env(),token=await pair(e),s=await add(e,token,'https://bigmodel.cn/finance-center/finance/overview','GLM 个人');
 await expect(ingest(e,token,s,22,'ok','USD','balance')).rejects.toThrow();await expect(ingest(e,token,s,22,'ok','CNY','requests')).rejects.toThrow();expect((await overview(e.DB))[0].snapshot).toBeNull();expect((await ingest(e,token,s,0,'ok','CNY','balance')).status).toBe(200);expect((await overview(e.DB))[0].snapshot?.items[0].amount).toBe(0);
 });
 it('upgrades only empty legacy taught presets and retains saved teaching and disable choices',async()=>{
 const e=env();await handleApi(request('providers',{type:'glm'}),e);let config=await syncConfig(e.DB);const s=config.sources[0];const old={...s,enabled:false,parser:'taught',locators:[]};await e.DB.prepare('UPDATE extension_sources SET config_json=? WHERE id=?').bind(JSON.stringify(old),s.id).run();config=await syncConfig(e.DB);expect(config.sources.find(x=>x.id===s.id)).toMatchObject({enabled:true,parser:s.parser});
 const disabled={...s,enabled:false};await e.DB.prepare('UPDATE extension_sources SET config_json=? WHERE id=?').bind(JSON.stringify(disabled),s.id).run();expect((await syncConfig(e.DB)).sources.find(x=>x.id===s.id)?.enabled).toBe(false);
 const taught={...s,enabled:false,parser:'taught',locators:[{id:'balance',name:'余额',label:'当前余额',css:'#stable',valueRegex:'([+-]?\\d+(?:[.,]\\d+)?)',unit:'CNY',kind:'balance'}]};await e.DB.prepare('UPDATE extension_sources SET config_json=? WHERE id=?').bind(JSON.stringify(taught),s.id).run();expect((await syncConfig(e.DB)).sources.find(x=>x.id===s.id)).toEqual(taught);
 });
 it('edits account labels atomically and keeps account identity on successful observations',async()=>{
 const e=env(),token=await pair(e),s=await add(e,token,'https://aistudio.google.com/usage?authuser=0','Google A');await ingest(e,token,s,21);await handleApi(request(`providers/${s.providerId}/account`,{accountLabel:'Google 个人'}),e);expect((await overview(e.DB))[0].accountLabel).toBe('Google 个人');expect((await syncConfig(e.DB)).sources.every(x=>x.accountLabel==='Google 个人')).toBe(true);expect((await overview(e.DB))[0].snapshot?.facts.accountLabel).toBe('Google A');
 });
 it('migration is additive and legacy provider configs retain the default account',async()=>{
 const db=database();await db.prepare('INSERT INTO providers(id,provider_type,label,category,source_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('legacy','gemini','Gemini','subscription','manual',1,1).run();expect((await overview(db))[0].accountLabel).toBe('默认账户');const sql=readFileSync(new URL('../../migrations/0003_extension_accounts.sql',import.meta.url),'utf8');expect(sql).not.toMatch(/^(?:DROP|DELETE|ALTER TABLE.*DROP)\b/im);
 });
});
