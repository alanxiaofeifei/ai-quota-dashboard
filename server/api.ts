import { catalog, fieldsFor, preset } from '../shared/catalog';
import { InputError, manualItems, object, only, parseBrowserReport, type Provider, type Snapshot } from '../shared/contracts';
import { checkStatus, claimRefresh, concurrent, deferRefresh, overview, snapshotStatement } from './db';
import { credentialKind, fetchQuota, fetchOpenRouter } from './adapters';
import { decryptSecret, encryptSecret, writeBody } from './security';
import { AdapterError } from './fetch-safe';
import { operatorExtension } from './extension';
import { demoProviders } from './demo';
import type { Env } from '../worker/index';
export const json=(data: unknown,status=200,headers: HeadersInit={})=>Response.json(data,{status,headers});
function secretInput(value: unknown): string {
 if(typeof value!=='string' || value.length<1 || value.length>4096 || /\s|[^\x21-\x7e]/.test(value))throw new InputError('invalid_key');
 return value;
}
function slotInput(type:string,value:unknown):string {const slot=value??(type==='openrouter'?'management':'key');if(slot!=='key'&&!(type==='openrouter'&&slot==='management'))throw new InputError();return String(slot)}
function typeRegion(body: Record<string,unknown>) {
 if(typeof body.type!=='string' || !catalog.some(p=>p.type===body.type))throw new InputError('invalid_provider');
 const spec=preset(body.type);const region=body.region??'cn';
 if(typeof region!=='string' || (spec.regions ? !spec.regions.includes(region) : region!=='cn'))throw new InputError('invalid_region');
 return {spec,region};
}
async function refreshProvider(db: D1Database,master: string,p: Provider,now: number) {
 if(!p.credential.configured || preset(p.type).mode!=='api' || !await claimRefresh(db,p.id,now))return;
 const credentials=(await db.prepare('SELECT slot,key_kind,aad_provider_id,cipher_json FROM credentials WHERE provider_id=?').bind(p.id).all<{slot:string;key_kind:string;aad_provider_id:string|null;cipher_json:string}>()).results;
 if(!credentials.length)return;
 try{
  const slots:Record<string,string>={};for(const c of credentials)slots[c.slot]=await decryptSecret(master,c.aad_provider_id??p.id,c.key_kind,c.cipher_json);
  const result=p.type==='openrouter'?await fetchOpenRouter(slots):await fetchQuota(p.type,p.region,slots.key);
  const s: Snapshot={...result,accountLabel:p.accountLabel??'默认账户',facts:{...result.facts,accountLabel:p.accountLabel??'默认账户'},source:'api',observedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString(),staleAfter:3600};
  await db.batch([snapshotStatement(db,p.id,s,now),db.prepare('UPDATE credentials SET last_check_at=?,last_check_status=?,last_error_code=NULL,updated_at=? WHERE provider_id=?').bind(now,'ok',now,p.id)]);
 }catch(e){
  const error=e instanceof AdapterError?e:new AdapterError('upstream_error');
  await checkStatus(db,p.id,now,error.code);await deferRefresh(db,p.id,now+Math.max(60,error.retryAfter)*1000);
 }
}
export async function handleApi(request: Request,env: Env): Promise<Response> {
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/api/extension')return operatorExtension(request,env);
 if(request.method==='GET' && path==='/api/overview')return json({mode:env.AUTH_MODE,providers:env.AUTH_MODE==='demo'?demoProviders():await overview(env.DB)});
 if(request.method!=='POST')return json({error:'not_found'},404);
 const body=await writeBody(request);
 if(env.AUTH_MODE==='demo')return json({error:'demo_read_only',message:'演示模式不保存密钥或数值，也不会访问供应商。 Demo mode is read-only; no provider requests are made.'},403);
 if(path==='/api/extension')return operatorExtension(request,env,body);
 const db=env.DB,now=Date.now();
 if(path==='/api/providers/test') {
  only(body,['type','region','key','slot']);const {spec,region}=typeRegion(body);if(spec.mode!=='api')throw new InputError();
  const secret=secretInput(body.key);const slot=slotInput(spec.type,body.slot);
  // Tests use a D1-backed per-type cooldown too; no preview bypass of rate limits.
  const lock=await db.prepare(`INSERT INTO meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(meta.value AS INTEGER)<=?`).bind(`test:${spec.type}`,String(now+60000),now,now).run();
  if(lock.meta.changes!==1)return json({error:'cooldown'},429,{'Retry-After':'60'});
  try{return json({preview:await (spec.type==='openrouter'?fetchOpenRouter({[slot]:secret}):fetchQuota(spec.type,region,secret))})}catch(e){
   if(e instanceof AdapterError)await db.prepare('UPDATE meta SET value=? WHERE key=?').bind(String(now+e.retryAfter*1000),`test:${spec.type}`).run();
   throw e;
  }
 }
 if(path==='/api/providers') {
  only(body,['type','region','label','key','slot','management','accountLabel','pageOnly']);const {spec,region}=typeRegion(body);
  if(spec.mode==='api')slotInput(spec.type,body.slot);if(body.management!==undefined&&body.slot!==undefined)throw new InputError();
  if(spec.type!=='openrouter'&&(body.management!==undefined||body.slot!==undefined&&body.slot!=='key'))throw new InputError();
  const label=body.label??spec.name;if(typeof label!=='string' || !label.trim() || label.length>80 || /[\x00-\x1f]/.test(label))throw new InputError();
  const accountLabel=body.accountLabel??'默认账户';if(typeof accountLabel!=='string'||!accountLabel.trim()||accountLabel.length>80||/[\x00-\x1f]/.test(accountLabel))throw new InputError();
  if(body.pageOnly!==undefined&&body.pageOnly!==true)throw new InputError();
  const id=crypto.randomUUID();const statements=[db.prepare(`INSERT INTO providers(id,provider_type,label,category,source_mode,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id,spec.type,label.trim(),spec.mode==='api'?'api_balance':'subscription',spec.mode,JSON.stringify({region,accountLabel:accountLabel.trim()}),now,now)];
  if(spec.mode==='api'&&body.pageOnly!==true) {
   if(!env.MASTER_ENCRYPTION_KEY)throw new InputError('encryption_not_configured',503);
   const secrets=spec.type==='openrouter' ? (body.management!==undefined ? [['management',body.management],...(body.key!==undefined?[['key',body.key]]:[])] : [[slotInput(spec.type,body.slot),body.key]]) : [['key',body.key]];
   for(const [slot,value] of secrets){const secret=secretInput(value),kind=credentialKind(spec.type,String(slot));
    const cipher=await encryptSecret(env.MASTER_ENCRYPTION_KEY,id,kind,secret);
    statements.push(db.prepare('INSERT INTO credentials(provider_id,slot,key_kind,cipher_json,updated_at) VALUES(?,?,?,?,?)').bind(id,slot,kind,cipher,now));
   }
  }else if(body.key!==undefined||body.management!==undefined||body.slot!==undefined)throw new InputError();
  await db.batch(statements);return json({id},201);
 }
 if(path==='/api/refresh') {
  only(body,['id']);if(body.id!==undefined && typeof body.id!=='string')throw new InputError();
  const all=await overview(db);const selected=all.filter(p=>(body.id===undefined||p.id===body.id)&&preset(p.type).mode==='api'&&p.credential.configured);
  if(body.id!==undefined && !all.some(p=>p.id===body.id))return json({error:'not_found'},404);
  if(selected.some(p=>p.nextAllowedFetch<=now) && !env.MASTER_ENCRYPTION_KEY)throw new InputError('encryption_not_configured',503);
  await concurrent(selected,6,p=>refreshProvider(db,env.MASTER_ENCRYPTION_KEY??'',p,now));
  const providers=await overview(db);const next=providers.filter(p=>selected.some(s=>s.id===p.id)).map(p=>p.nextAllowedFetch);
  const wait=next.length?Math.max(1,Math.ceil((Math.min(...next)-now)/1000)):60;
  return json({providers},200,{'Retry-After':String(wait)});
 }
 const match=path.match(/^\/api\/providers\/([a-f0-9-]{36})\/(credential|manual|import|account)$/);
 if(!match)return json({error:'not_found'},404);
 const [,id,action]=match;const p=(await overview(db)).find(p=>p.id===id);if(!p)return json({error:'not_found'},404);
 if(action==='account'){
  only(body,['accountLabel']);if(typeof body.accountLabel!=='string'||!body.accountLabel.trim()||body.accountLabel.length>80||/[\x00-\x1f]/.test(body.accountLabel))throw new InputError();
  const accountLabel=body.accountLabel.trim();
  const row=await db.prepare('SELECT config_json FROM providers WHERE id=?').bind(id).first<{config_json:string}>();
  const sources=(await db.prepare('SELECT id,config_json FROM extension_sources').all<{id:string;config_json:string}>()).results.filter(r=>JSON.parse(r.config_json).providerId===id);
  await db.batch([db.prepare('UPDATE providers SET config_json=?,updated_at=? WHERE id=?').bind(JSON.stringify({...JSON.parse(row!.config_json),accountLabel}),now,id),...sources.map(r=>db.prepare('UPDATE extension_sources SET config_json=?,updated_at=? WHERE id=?').bind(JSON.stringify({...JSON.parse(r.config_json),accountLabel}),now,r.id))]);return json({saved:true});
 }
 if(action==='credential') {
  only(body,['key','clear','slot']);const slot=slotInput(p.type,body.slot);if(preset(p.type).mode!=='api')throw new InputError();
  if(body.clear===true) {
   if(body.key!==undefined)throw new InputError();
   await db.prepare('DELETE FROM credentials WHERE provider_id=? AND slot=?').bind(id,slot).run();
  }else {
   if(body.clear!==undefined)throw new InputError();const secret=secretInput(body.key),kind=credentialKind(p.type,slot);
   if(!env.MASTER_ENCRYPTION_KEY)throw new InputError('encryption_not_configured',503);
   const cipher=await encryptSecret(env.MASTER_ENCRYPTION_KEY,id,kind,secret);
   await db.prepare(`INSERT INTO credentials(provider_id,slot,key_kind,cipher_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(provider_id,slot) DO UPDATE SET key_kind=excluded.key_kind,aad_provider_id=NULL,cipher_json=excluded.cipher_json,last_check_at=NULL,last_check_status='unverified',last_error_code=NULL,updated_at=excluded.updated_at`).bind(id,slot,kind,cipher,now).run();
  }
  if(p.type==='openrouter')await db.prepare('DELETE FROM snapshots WHERE provider_id=?').bind(id).run();
  return json({credential:(await overview(db)).find(p=>p.id===id)!.credential});
 }
 if(preset(p.type).mode==='api')throw new InputError();
 let snapshot: Snapshot;
 if(action==='import') {
  only(body,['report']);if(p.type!=='chatgpt')throw new InputError();snapshot=parseBrowserReport(body.report,now);
  if(p.snapshot && Date.parse(snapshot.observedAt)<Date.parse(p.snapshot.observedAt))throw new InputError('older_observation',409);
 }else {
  only(body,['items']);const items=manualItems(body.items,now);
  if(p.type!=='custom' && items.some(i=>!fieldsFor(p.type,p.region).some(f=>f.id===i.id&&f.unit===i.unit)))throw new InputError();
  snapshot={items,source:'manual',observedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString(),staleAfter:86400,facts:{}};
 }
 snapshot={...snapshot,accountLabel:p.accountLabel??'默认账户',facts:{...snapshot.facts,accountLabel:p.accountLabel??'默认账户'}};
 const saved=await snapshotStatement(db,id,snapshot,now).run();if(saved.meta.changes!==1)throw new InputError('older_observation',409);return json({saved:true});
}
