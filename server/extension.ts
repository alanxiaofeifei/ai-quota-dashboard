import type { Env } from '../worker/index';
import { presets,matchPreset,accountIndex,samePage } from '../browser-extension/presets.mjs';
import { catalog, officialUrl } from '../shared/catalog';
import { InputError, object, only } from '../shared/contracts';
import { defaultSources, parseDefaultInterval, parseIngest, parseSource, type Device, type SyncSource, type SyncStatus } from '../shared/extension';
import { base64, boundedText } from './security';
import { overview, snapshotStatement } from './db';
import { json } from './api';
export async function hashToken(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('')}
export function constantEqual(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<64;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
const extensionOrigin=(origin:string|null)=>!!origin&&/^chrome-extension:\/\/[a-p]{32}$/.test(origin);
export function extCors(request:Request,response:Response){const r=new Response(response.body,response);const origin=request.headers.get('Origin');if(extensionOrigin(origin)){r.headers.set('Access-Control-Allow-Origin',origin!);r.headers.set('Vary','Origin');r.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');r.headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS')}return r}
export async function syncConfig(db:D1Database){
 const providers=await overview(db);const defaults=defaultSources(providers);
 const setting=await db.prepare("SELECT value FROM meta WHERE key='extension_default_interval'").first<{value:string}>();
 const defaultIntervalMinutes=setting?parseDefaultInterval(Number(setting.value)):60;
 if(defaults.length)await db.batch(defaults.map(s=>db.prepare('INSERT OR IGNORE INTO extension_sources(id,config_json,updated_at) VALUES(?,?,?)').bind(s.id,JSON.stringify(s),Date.now())));
 const legacy=(await db.prepare('SELECT id,config_json FROM extension_sources').all<{id:string;config_json:string}>()).results;
 const upgrades=[];
 for(const row of legacy){const s=JSON.parse(row.config_json) as SyncSource;if(s.parser!=='taught'||s.locators.length)continue;
 let preset=matchPreset(s.url);if(!preset&&new URL(s.url).hostname==='gemini.google.com'&&accountIndex(s.url)!==null){preset=presets.find(p=>p.id==='gemini')!;s.url=`${preset.url}?authuser=${accountIndex(s.url)??'0'}`}
 if(preset){s.parser=preset.parser;s.enabled=true;upgrades.push(db.prepare('UPDATE extension_sources SET config_json=?,updated_at=? WHERE id=?').bind(JSON.stringify(s),Date.now(),s.id))}
 }if(upgrades.length)await db.batch(upgrades);
 const sources=(await db.prepare('SELECT config_json FROM extension_sources ORDER BY id').all<{config_json:string}>()).results.map(r=>JSON.parse(r.config_json) as SyncSource).map(s=>s.useDefaultInterval?{...s,intervalMinutes:defaultIntervalMinutes}:s);
 const devices=(await db.prepare('SELECT id,name,created_at,last_seen,revoked_at FROM devices ORDER BY created_at').all<{id:string;name:string;created_at:number;last_seen:number|null;revoked_at:number|null}>()).results.map(r=>({id:r.id,name:r.name,createdAt:r.created_at,lastSeen:r.last_seen,revokedAt:r.revoked_at}));
 const statuses=(await db.prepare('SELECT * FROM extension_status').all<{source_id:string;device_id:string|null;status:SyncStatus['status'];observed_at:string;last_success:string|null}>()).results.map(r=>({sourceId:r.source_id,deviceId:r.device_id,status:r.status,observedAt:r.observed_at,lastSuccess:r.last_success}));
 return {sources,defaultIntervalMinutes,devices:devices as Device[],statuses};
}
async function saveSources(db:D1Database,value:unknown,interval?:unknown){
 const defaultInterval=interval===undefined?undefined:parseDefaultInterval(interval);
 if(!Array.isArray(value)||value.length>80)throw new InputError();const sources=value.map(parseSource);if(new Set(sources.map(s=>s.id)).size!==sources.length)throw new InputError();
 const providers=await overview(db);if(sources.some(s=>!providers.some(p=>p.id===s.providerId&&(s.parser==='taught'||matchPreset(s.url)?.type===p.type))))throw new InputError('invalid_provider');
 const existing=(await db.prepare('SELECT config_json FROM extension_sources').all<{config_json:string}>()).results.map(r=>JSON.parse(r.config_json) as SyncSource);
 const effective=[...existing.filter(s=>!sources.some(x=>x.id===s.id)),...sources];
 for(const p of providers){const group=effective.filter(s=>s.providerId===p.id);if(new Set(group.map(s=>s.accountLabel??p.accountLabel??'默认账户')).size>1)throw new InputError('account_mismatch');
 if(p.type==='gemini'&&new Set(group.map(s=>accountIndex(s.url))).size>1)throw new InputError('account_mismatch');}
 const statements:D1PreparedStatement[]=[];
 if(defaultInterval!==undefined)statements.push(db.prepare("INSERT INTO meta(key,value,updated_at) VALUES('extension_default_interval',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(defaultInterval),Date.now()));
 for(const s of sources){
 const before=existing.find(x=>x.id===s.id);
 if(before&&(before.url!==s.url||before.providerId!==s.providerId||before.parser!==s.parser||JSON.stringify(before.locators)!==JSON.stringify(s.locators)))statements.push(db.prepare('DELETE FROM extension_status WHERE source_id=?').bind(s.id));
 statements.push(db.prepare('INSERT INTO extension_sources(id,config_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at').bind(s.id,JSON.stringify(s),Date.now()));
 }
 for(const p of providers){const group=sources.filter(s=>s.providerId===p.id);if(!group.length)continue;
 const row=await db.prepare('SELECT config_json FROM providers WHERE id=?').bind(p.id).first<{config_json:string}>();
 statements.push(db.prepare('UPDATE providers SET config_json=?,updated_at=? WHERE id=?').bind(JSON.stringify({...JSON.parse(row!.config_json),accountLabel:group[0].accountLabel??p.accountLabel??'默认账户',usageUrl:group[0].url}),Date.now(),p.id));}
 if(statements.length)await db.batch(statements);

 // Omitted sources remain available; disable rather than silently delete taught locators.
 return json({saved:true});
}
export async function operatorExtension(request:Request,env:Env,body?:Record<string,unknown>){
 if(request.method==='GET')return json(env.AUTH_MODE==='demo'?{sources:defaultSources((await import('./demo')).demoProviders()).map(s=>({...s,enabled:false})),defaultIntervalMinutes:60,devices:[],statuses:[]}:await syncConfig(env.DB));
 if(env.AUTH_MODE==='demo')return json({error:'demo_read_only'},403);
 const b=body!;
 if(b.action==='pair'){
 only(b,['action','name']);if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw new InputError();
 const token=base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await env.DB.prepare('INSERT INTO devices(id,token_hash,name,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),await hashToken(token),b.name.trim(),Date.now()).run();
 const payload=base64(new TextEncoder().encode(JSON.stringify({url:new URL(request.url).origin,token}))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 return json({code:`aiq1.${payload}`},201);
 }
 if(b.action==='revoke'){only(b,['action','id']);if(typeof b.id!=='string')throw new InputError();await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(Date.now(),b.id).run();return json({revoked:true})}
 if(b.action==='sources'){only(b,['action','sources','defaultIntervalMinutes']);return saveSources(env.DB,b.sources,b.defaultIntervalMinutes)}
 throw new InputError();
}
async function addPage(db:D1Database,value:unknown){
 const b=object(value);only(b,['url','accountLabel']);if(typeof b.url!=='string'||typeof b.accountLabel!=='string'||!b.accountLabel.trim()||b.accountLabel.length>80||/[\x00-\x1f]/.test(b.accountLabel))throw new InputError();
 const page=matchPreset(b.url);if(!page)throw new InputError('invalid_source_url');
 const config=await syncConfig(db);if(config.sources.some(s=>samePage(s.url,b.url as string)))throw new InputError('source_exists',409);
 const providers=await overview(db),accountLabel=b.accountLabel.trim(),region=page.id.endsWith('intl')?(page.type==='siliconflow'?'com':'ai'):'cn';
 const existing=providers.filter(p=>p.type===page.type&&p.accountLabel===accountLabel&&p.region===region);
 if(existing.length>1)throw new InputError('account_mismatch');
 if(existing[0]&&config.sources.some(s=>s.providerId===existing[0].id&&page.type==='gemini'&&accountIndex(s.url)!==accountIndex(b.url as string)))throw new InputError('account_mismatch');
 const id=existing[0]?.id??crypto.randomUUID(),now=Date.now();
 const canonical=defaultSources([{id,type:page.type,region,label:page.name,accountLabel,usageUrl:b.url}]).find(s=>s.parser===page.parser);
 const source:SyncSource={id:canonical?.id??crypto.randomUUID(),providerId:id,label:page.name,accountLabel,url:b.url,enabled:true,intervalMinutes:config.defaultIntervalMinutes,useDefaultInterval:true,parser:page.parser,locators:[]};
 const statements=[];
 if(!existing[0])statements.push(db.prepare('INSERT INTO providers(id,provider_type,label,category,source_mode,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,page.type,page.name,'subscription','manual',JSON.stringify({region,accountLabel,usageUrl:b.url}),now,now));
 statements.push(db.prepare('INSERT INTO extension_sources(id,config_json,updated_at) VALUES(?,?,?)').bind(source.id,JSON.stringify(source),now));await db.batch(statements);return json({source},201);
}
export async function handleExtension(request:Request,env:Env):Promise<Response>{
 const origin=request.headers.get('Origin');if(origin&&!extensionOrigin(origin))return json({error:'origin_rejected'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204});
 const bearer=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!bearer)return json({error:'unauthorized'},401);
 const hash=await hashToken(bearer);const device=await env.DB.prepare('SELECT id,token_hash,revoked_at FROM devices WHERE token_hash=?').bind(hash).first<{id:string;token_hash:string;revoked_at:number|null}>();
 if(!constantEqual(hash,device?.token_hash??'')||!device||device.revoked_at!==null)return json({error:'unauthorized'},401);
 const now=Date.now(),rateId=`ext:${device.id}`;
 const rate=await env.DB.prepare(`INSERT INTO auth_rate(id,hits,reset_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING hits`).bind(rateId,now+60000,now,now).first<{hits:number}>();
 if(!rate||rate.hits>120)return json({error:'rate_limited'},429,{'Retry-After':'60'});
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/api/ext/config'){const {sources,defaultIntervalMinutes}=await syncConfig(env.DB);return json({sources,defaultIntervalMinutes})}
 if(request.method==='GET'&&path==='/api/ext/summary')return json(await extensionSummary(env.DB,now));
 if(request.method!=='POST')return json({error:'not_found'},404);
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))throw new InputError('json_required',415);
 let b:Record<string,unknown>;const text=await boundedText(request.body,32768,request.headers.get('Content-Length'));try{b=object(JSON.parse(text))}catch{throw new InputError('invalid_json')}
 if(path==='/api/ext/hello'||path==='/api/ext/heartbeat'||path==='/api/ext/status'){
 only(b,[]);await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now,device.id).run();return json({ok:true});
 }
 if(path==='/api/ext/config'){if(b.addPage!==undefined){only(b,['addPage']);return addPage(env.DB,b.addPage)}only(b,['sources','defaultIntervalMinutes']);return saveSources(env.DB,b.sources,b.defaultIntervalMinutes)}
 if(path==='/api/ext/ingest'){
 const ingest=parseIngest(b,now),config=await syncConfig(env.DB),source=config.sources.find(s=>s.id===ingest.sourceId&&s.providerId===ingest.providerId&&s.enabled);
 if(!source)throw new InputError('invalid_source');
 const prev=config.statuses.find(s=>s.sourceId===source.id);if(prev&&Date.parse(prev.observedAt)>Date.parse(ingest.observedAt))throw new InputError('older_observation',409);
 if(ingest.items.some(i=>!(source.parser==='taught'&&source.locators.some(l=>l.id===i.id&&l.unit===i.unit))&&!(source.parser!=='taught'&&presets.find(p=>p.parser===source.parser)?.metrics[i.id]===i.unit)))throw new InputError();
 const statements=[env.DB.prepare(`INSERT INTO extension_status(source_id,device_id,status,observed_at,last_success) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET device_id=excluded.device_id,status=excluded.status,observed_at=excluded.observed_at,last_success=CASE WHEN excluded.status='ok' THEN excluded.observed_at ELSE extension_status.last_success END WHERE excluded.observed_at>=extension_status.observed_at`).bind(source.id,device.id,ingest.status,ingest.observedAt,ingest.status==='ok'?ingest.observedAt:null),env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now,device.id)];
 if(ingest.status==='ok'){
 const snapshot={items:ingest.items.map(i=>({...i,label:source.locators.find(l=>l.id===i.id)?.name??i.id})),facts:{accountLabel:source.accountLabel??'默认账户'},accountLabel:source.accountLabel??'默认账户',source:'extension' as const,observedAt:ingest.observedAt,fetchedAt:new Date(now).toISOString(),staleAfter:source.intervalMinutes*120};
 const provider=(await overview(env.DB)).find(p=>p.id===source.providerId)!;
 if(catalog.find(c=>c.type===provider.type)?.mode==='api')statements.push(env.DB.prepare(`INSERT INTO extension_snapshots(provider_id,snapshot_json,updated_at) VALUES(?,?,?) ON CONFLICT(provider_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at WHERE json_extract(excluded.snapshot_json,'$.observedAt')>=json_extract(extension_snapshots.snapshot_json,'$.observedAt')`).bind(source.providerId,JSON.stringify(snapshot),now));
 else statements.push(snapshotStatement(env.DB,source.providerId,snapshot,now));
 }

 await env.DB.batch(statements);return json({accepted:true});
 }
 return json({error:'not_found'},404);
}

// Explicit projection: never serialize Provider, credentials, device or locator records.
export async function extensionSummary(db:D1Database,now=Date.now()){
 const [providers,config]=await Promise.all([overview(db),syncConfig(db)]);
 return {providers:providers.sort((a,b)=>a.type.localeCompare(b.type)||(a.accountLabel??'默认账户').localeCompare(b.accountLabel??'默认账户')).map(p=>{
 const sources=config.sources.filter(s=>s.providerId===p.id&&s.enabled);
 const statuses=sources.map(s=>config.statuses.find(st=>st.sourceId===s.id));
 const offline=sources.length>0&&!config.devices.some(d=>d.revokedAt===null&&now-(d.lastSeen??d.createdAt)<=Math.min(...sources.map(s=>s.intervalMinutes))*120000);
 const stale=!p.snapshot||now-Date.parse(p.snapshot.observedAt)>(sources.length?Math.min(...sources.map(s=>s.intervalMinutes))*120000:p.snapshot.staleAfter*1000)||statuses.some(st=>st&&!st.lastSuccess)||p.snapshot?.source==='extension'&&sources.length>0&&!statuses.some(st=>st?.lastSuccess);
 const status=statuses.some(s=>s?.status==='login_required')?'login_required':statuses.some(s=>s?.status==='layout_changed')?'layout_changed':p.credential.lastErrorCode||statuses.some(s=>s&&s.status!=='ok')?'error':offline?'offline':stale?'stale':'ok';
 const primary=p.snapshot?.items[0];
 const reason=statuses.find(s=>s&&s.status!=='ok')?.status??(p.type==='openrouter'&&primary?.amount==null?'management_key_required':!sources.length&&config.sources.some(s=>s.providerId===p.id)?'disabled':!p.snapshot?'not_synced':null);
 return {id:p.id,name:p.label,providerType:p.type,accountLabel:p.accountLabel??'默认账户',source:p.snapshot?.source??null,reason,usageUrl:p.usageUrl??officialUrl(p.type,p.region),primary:primary?{value:primary.amount,unit:primary.unit}:null,reset_at:primary?.resetAt??p.snapshot?.items.find(i=>i.resetAt)?.resetAt??null,last_sync_at:p.snapshot?.observedAt??null,status};
 })};
}
