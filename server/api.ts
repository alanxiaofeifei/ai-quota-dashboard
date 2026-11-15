import { catalog, fieldsFor, preset } from '../shared/catalog';
import { InputError, manualItems, object, only, parseBrowserReport, type Provider, type Snapshot } from '../shared/contracts';
import { checkStatus, claimRefresh, concurrent, deferRefresh, overview, snapshotStatement } from './db';
import { credentialKind, fetchQuota } from './adapters';
import { decryptSecret, encryptSecret, writeBody } from './security';
import { AdapterError } from './fetch-safe';
import { demoProviders } from './demo';
import type { Env } from '../worker/index';
export const json=(data: unknown,status=200,headers: HeadersInit={})=>Response.json(data,{status,headers});
function secretInput(value: unknown): string {
 if(typeof value!=='string' || value.length<1 || value.length>4096 || /\s|[^\x21-\x7e]/.test(value))throw new InputError('invalid_key');
 return value;
}
function typeRegion(body: Record<string,unknown>) {
 if(typeof body.type!=='string' || !catalog.some(p=>p.type===body.type))throw new InputError('invalid_provider');
 const spec=preset(body.type);const region=body.region??'cn';
 if(typeof region!=='string' || (spec.regions ? !spec.regions.includes(region) : region!=='cn'))throw new InputError('invalid_region');
 return {spec,region};
}
async function refreshProvider(db: D1Database,master: string,p: Provider,now: number) {
 if(!p.credential.configured || preset(p.type).mode!=='api' || !await claimRefresh(db,p.id,now))return;
 const credential=await db.prepare('SELECT key_kind,cipher_json FROM credentials WHERE provider_id=?').bind(p.id).first<{key_kind:string;cipher_json:string}>();
 if(!credential)return;
 try{
  const secret=await decryptSecret(master,p.id,credential.key_kind,credential.cipher_json);
  const result=await fetchQuota(p.type,p.region,secret);
  const s: Snapshot={...result,source:'api',observedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString(),staleAfter:3600};
  await db.batch([snapshotStatement(db,p.id,s,now),db.prepare('UPDATE credentials SET last_check_at=?,last_check_status=?,last_error_code=NULL,updated_at=? WHERE provider_id=?').bind(now,'ok',now,p.id)]);
 }catch(e){
  const error=e instanceof AdapterError?e:new AdapterError('upstream_error');
  await checkStatus(db,p.id,now,error.code);await deferRefresh(db,p.id,now+Math.max(60,error.retryAfter)*1000);
 }
}
export async function handleApi(request: Request,env: Env): Promise<Response> {
 const path=new URL(request.url).pathname;
 if(request.method==='GET' && path==='/api/overview')return json({mode:env.AUTH_MODE,providers:env.AUTH_MODE==='demo'?demoProviders():await overview(env.DB)});
 if(request.method!=='POST')return json({error:'not_found'},404);
 const body=await writeBody(request);
 if(env.AUTH_MODE==='demo')return json({error:'demo_read_only',message:'演示模式不保存密钥或数值，也不会访问供应商。 Demo mode is read-only; no provider requests are made.'},403);
 const db=env.DB,now=Date.now();
 if(path==='/api/providers/test') {
  only(body,['type','region','key']);const {spec,region}=typeRegion(body);if(spec.mode!=='api')throw new InputError();
  const secret=secretInput(body.key);
  // Tests use a D1-backed per-type cooldown too; no preview bypass of rate limits.
  const lock=await db.prepare(`INSERT INTO meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(meta.value AS INTEGER)<=?`).bind(`test:${spec.type}`,String(now+60000),now,now).run();
  if(lock.meta.changes!==1)return json({error:'cooldown'},429,{'Retry-After':'60'});
  try{return json({preview:await fetchQuota(spec.type,region,secret)})}catch(e){
   if(e instanceof AdapterError)await db.prepare('UPDATE meta SET value=? WHERE key=?').bind(String(now+e.retryAfter*1000),`test:${spec.type}`).run();
   throw e;
  }
 }
 if(path==='/api/providers') {
  only(body,['type','region','label','key']);const {spec,region}=typeRegion(body);
  const label=body.label??spec.name;if(typeof label!=='string' || !label.trim() || label.length>80 || /[\x00-\x1f]/.test(label))throw new InputError();
  const id=crypto.randomUUID();const statements=[db.prepare(`INSERT INTO providers(id,provider_type,label,category,source_mode,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id,spec.type,label.trim(),spec.mode==='api'?'api_balance':'subscription',spec.mode,JSON.stringify({region}),now,now)];
  if(spec.mode==='api') {
   const secret=secretInput(body.key),kind=credentialKind(spec.type);
   if(!env.MASTER_ENCRYPTION_KEY)throw new InputError('encryption_not_configured',503);
   const cipher=await encryptSecret(env.MASTER_ENCRYPTION_KEY,id,kind,secret);
   statements.push(db.prepare('INSERT INTO credentials(provider_id,key_kind,cipher_json,updated_at) VALUES(?,?,?,?)').bind(id,kind,cipher,now));
  }else if(body.key!==undefined)throw new InputError();
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
 const match=path.match(/^\/api\/providers\/([a-f0-9-]{36})\/(credential|manual|import)$/);
 if(!match)return json({error:'not_found'},404);
 const [,id,action]=match;const p=(await overview(db)).find(p=>p.id===id);if(!p)return json({error:'not_found'},404);
 if(action==='credential') {
  only(body,['key','clear']);if(preset(p.type).mode!=='api')throw new InputError();
  if(body.clear===true) {
   if(body.key!==undefined)throw new InputError();
   await db.prepare('DELETE FROM credentials WHERE provider_id=?').bind(id).run();
  }else {
   if(body.clear!==undefined)throw new InputError();const secret=secretInput(body.key),kind=credentialKind(p.type);
   if(!env.MASTER_ENCRYPTION_KEY)throw new InputError('encryption_not_configured',503);
   const cipher=await encryptSecret(env.MASTER_ENCRYPTION_KEY,id,kind,secret);
   await db.prepare(`INSERT INTO credentials(provider_id,key_kind,cipher_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET key_kind=excluded.key_kind,cipher_json=excluded.cipher_json,last_check_at=NULL,last_check_status='unverified',last_error_code=NULL,updated_at=excluded.updated_at`).bind(id,kind,cipher,now).run();
  }
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
 const saved=await snapshotStatement(db,id,snapshot,now).run();if(saved.meta.changes!==1)throw new InputError('older_observation',409);return json({saved:true});
}
