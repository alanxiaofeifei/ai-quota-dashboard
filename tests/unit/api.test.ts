import { describe,it,expect,vi } from 'vitest';
import { database } from './fake-d1';
import { handleApi } from '../../server/api';
import { base64,decryptSecret } from '../../server/security';
import { claimRefresh,concurrent,overview,snapshotStatement } from '../../server/db';
import type { Env } from '../../worker/index';
const secret='SYNTHETIC_BEARER_DO_NOT_ECHO';
function environment():Env{return {DB:database(),ASSETS:{} as Fetcher,AUTH_MODE:'access',MASTER_ENCRYPTION_KEY:base64(new Uint8Array(32).fill(9))}}
const post=(path:string,body:unknown)=>new Request(`https://quota.test${path}`,{method:'POST',headers:{Origin:'https://quota.test','Content-Type':'application/json'},body:JSON.stringify(body)});
const get=()=>new Request('https://quota.test/api/overview');
async function create(env:Env,type='deepseek',extra:Record<string,unknown>={}) {
 const result=await handleApi(post('/api/providers',{type,...(type==='chatgpt'?{}:{key:secret}),...extra}),env);
 expect(result.status).toBe(201);return (await result.json() as {id:string}).id;
}
function upstream(amount='110.00') {vi.mocked(fetch).mockResolvedValue(Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:amount,granted_balance:'10',topped_up_balance:'100'}]}))}
describe('D1-backed API and credential lifecycle',()=>{
 it('encrypts POST-only keys and never returns keys, suffixes, or ciphertext',async()=>{
  const log=vi.spyOn(console,'log'),warn=vi.spyOn(console,'warn'),error=vi.spyOn(console,'error');const env=environment(),id=await create(env);
  const stored=await env.DB.prepare('SELECT * FROM credentials WHERE provider_id=?').bind(id).first<{key_kind:string;cipher_json:string}>();
  expect(stored!.cipher_json).not.toContain(secret);expect(await decryptSecret(env.MASTER_ENCRYPTION_KEY!,id,'bearer',stored!.cipher_json)).toBe(secret);
  const body=await (await handleApi(get(),env)).text();expect(body).not.toContain(secret);expect(body).not.toContain('cipher');expect(body).not.toContain('last4');
  const p=JSON.parse(body).providers[0];expect(Object.keys(p.credential).sort()).toEqual(['configured','lastCheckAt','lastCheckStatus','lastErrorCode'].sort());
  const replacement=await handleApi(post(`/api/providers/${id}/credential`,{key:'SECOND_SYNTHETIC_KEY'}),env);expect(await replacement.text()).not.toContain('SYNTHETIC');
  const cleared=await handleApi(post(`/api/providers/${id}/credential`,{clear:true}),env);expect((await cleared.json() as {credential:{configured:boolean}}).credential.configured).toBe(false);
  expect(await env.DB.prepare('SELECT * FROM credentials WHERE provider_id=?').bind(id).first()).toBeNull();expect(log).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
 });
 it('requires encryption config and rejects arbitrary URLs, regions and unknown fields',async()=>{
  const env=environment();delete env.MASTER_ENCRYPTION_KEY;
  await expect(handleApi(post('/api/providers',{type:'deepseek',key:secret}),env)).rejects.toMatchObject({status:503});expect(await overview(env.DB)).toEqual([]);
  for(const body of [{type:'moonshot',region:'evil.invalid',key:secret},{type:'deepseek',baseUrl:'https://evil.invalid',key:secret},{type:'unknown',key:secret}])await expect(handleApi(post('/api/providers',body),environment())).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 });
 it('test previews do not save keys or snapshots and have their own cooldown',async()=>{
  const env=environment();upstream();const result=await handleApi(post('/api/providers/test',{type:'deepseek',key:secret}),env);
  const text=await result.text();expect(text).toContain('110.00');expect(text).not.toContain(secret);expect(await overview(env.DB)).toEqual([]);
  expect((await env.DB.prepare('SELECT * FROM credentials').all()).results).toEqual([]);
  expect((await handleApi(post('/api/providers/test',{type:'deepseek',key:secret}),env)).status).toBe(429);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('refresh preserves last good snapshot on 429 and stores Retry-After',async()=>{
  const env=environment(),id=await create(env);upstream();let result=await handleApi(post('/api/refresh',{id}),env);expect(result.status).toBe(200);
  const before=(await overview(env.DB))[0];expect(before.snapshot!.items[0].amount).toBe('110.00');
  await env.DB.prepare('UPDATE providers SET next_allowed_fetch_ms=0 WHERE id=?').bind(id).run();
  vi.mocked(fetch).mockResolvedValue(new Response(secret,{status:429,headers:{'Retry-After':'180'}}));const started=Date.now();
  result=await handleApi(post('/api/refresh',{id}),env);const body=await result.text();expect(body).not.toContain(secret);
  const after=(await overview(env.DB))[0];expect(after.snapshot).toEqual(before.snapshot);expect(after.credential.lastErrorCode).toBe('rate_limited');expect(after.nextAllowedFetch).toBeGreaterThanOrEqual(started+180000);
  await handleApi(post('/api/refresh',{id}),env);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('initial failure still gets a cooldown; overlapping claims have one winner',async()=>{
  const env=environment(),id=await create(env);vi.mocked(fetch).mockResolvedValue(new Response('unauthorized',{status:401}));
  await handleApi(post('/api/refresh',{id}),env);const p=(await overview(env.DB))[0];expect(p.snapshot).toBeNull();expect(p.credential.lastErrorCode).toBe('unauthorized');expect(p.nextAllowedFetch).toBeGreaterThan(Date.now());
  await env.DB.prepare('UPDATE providers SET next_allowed_fetch_ms=0 WHERE id=?').bind(id).run();
  const claims=await Promise.all([claimRefresh(env.DB,id,Date.now()),claimRefresh(env.DB,id,Date.now())]);expect(claims.filter(Boolean)).toHaveLength(1);
 });
 it('refresh single/all excludes manual providers and maxes at six concurrent fetches',async()=>{
  const env=environment();await create(env,'chatgpt');for(let i=0;i<8;i++)await create(env);
  let active=0,max=0;vi.mocked(fetch).mockImplementation(async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,8));active--;return Response.json({balance_infos:[{currency:'CNY',total_balance:'1'}]})});
  await handleApi(post('/api/refresh',{}),env);expect(fetch).toHaveBeenCalledTimes(8);expect(max).toBe(6);
 });
 it('manual blank values are null, percent/credits/currency stay separate',async()=>{
  const env=environment(),id=await create(env,'chatgpt');
  await handleApi(post(`/api/providers/${id}/manual`,{items:[{id:'weekly_percent',unit:'percent',amount:18,resetAt:'2h 15m'},{id:'five_hour_percent',unit:'percent',amount:null},{id:'credits',unit:'credits',amount:'12.75'}]}),env);
  const p=(await overview(env.DB))[0];expect(p.snapshot!.items[0].amount).toBe(18);expect(p.snapshot!.items[1].amount).toBeNull();expect(p.snapshot!.items[2].unit).toBe('credits');expect(p.snapshot!.staleAfter).toBe(86400);expect(Date.parse(p.snapshot!.items[0].resetAt!)-Date.parse(p.snapshot!.observedAt)).toBe(8100000);
  await expect(handleApi(post(`/api/providers/${id}/manual`,{items:[{id:'credits',unit:'USD',amount:10}]}),env)).rejects.toThrow();
 });
 it('imports actual extension contract and refuses older observations',async()=>{
  const env=environment(),id=await create(env,'chatgpt'),observed=Date.now()-120000;
  const report={schema_version:1,provider:'openai',source:'user_initiated_browser_selection',source_page:'https://chatgpt.com/settings/usage?tab=overview',page_read_at:new Date(observed).toISOString(),server_observed_at:null,freshness:'unknown',account:null,provider_pool_id:null,applies_to_products:null,real_account_verified:false,weekly:{window:'weekly',remaining_percent:64,resets_at:null,reset_relative:{label:'1h',seconds:3600,precision:'estimated_from_display'}},credits:null};
  await handleApi(post(`/api/providers/${id}/import`,{report}),env);expect((await overview(env.DB))[0].snapshot!.source).toBe('extension');
  await expect(handleApi(post(`/api/providers/${id}/import`,{report:{...report,page_read_at:new Date(observed-1).toISOString()}}),env)).rejects.toMatchObject({code:'older_observation'});
 });
 it('snapshots reject older writes atomically',async()=>{
  const env=environment(),id=await create(env,'chatgpt');const now=Date.now();const s={source:'manual' as const,items:[],facts:{},fetchedAt:new Date(now).toISOString(),observedAt:new Date(now).toISOString(),staleAfter:86400};
  await snapshotStatement(env.DB,id,s,now).run();const old=await snapshotStatement(env.DB,id,{...s,observedAt:new Date(now-1).toISOString()},now).run();expect(old.meta.changes).toBe(0);
 });
 it('concurrency helper never exceeds six',async()=>{let active=0,max=0;await concurrent(Array.from({length:18}),6,async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--});expect(max).toBe(6)});
 it('SiliconFlow is manual-only in both regions and never accepts a key',async()=>{
  const env=environment();
  await expect(handleApi(post('/api/providers',{type:'siliconflow',key:secret}),env)).rejects.toThrow();
  const created=await handleApi(post('/api/providers',{type:'siliconflow',region:'com'}),env);expect(created.status).toBe(201);const {id}=await created.json() as {id:string};
  await handleApi(post(`/api/providers/${id}/manual`,{items:[{id:'totalBalance',amount:'88.88',unit:'USD'}]}),env);
  expect((await overview(env.DB))[0].snapshot!.items[0].unit).toBe('USD');
  await handleApi(post('/api/refresh',{}),env);expect(fetch).not.toHaveBeenCalled();
 });

});
