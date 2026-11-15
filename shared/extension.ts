import { catalog, officialUrl } from './catalog';
import { InputError, manualItems, object, only, type Unit } from './contracts';
export const readStates=['ok','login_required','layout_changed','timeout','network'] as const;
export type ReadState=typeof readStates[number];
export interface Locator {id:string;name:string;label:string;css:string;valueRegex:string;unit:Unit;kind:'percent_remaining'|'percent_used'|'balance'|'credits'|'reset'}
export interface SyncSource {id:string;providerId:string;label:string;url:string;enabled:boolean;intervalMinutes:number;useDefaultInterval?:boolean;parser:'preset:chatgpt'|'preset:codex'|'taught';locators:Locator[]}
export interface SyncStatus {sourceId:string;deviceId:string|null;status:ReadState;observedAt:string;lastSuccess:string|null}
export interface Device {id:string;name:string;createdAt:number;lastSeen:number|null;revokedAt:number|null}
export const VALUE_REGEX='([+-]?\\d+(?:[.,]\\d+)?)';
function text(v:unknown,max=120):string {if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))throw new InputError();return v.trim()}
export function parseSource(value:unknown):SyncSource {
 const s=object(value);only(s,['id','providerId','label','url','enabled','intervalMinutes','useDefaultInterval','parser','locators']);
 if(s.useDefaultInterval!==undefined&&typeof s.useDefaultInterval!=='boolean')throw new InputError();
 const id=text(s.id,80),providerId=text(s.providerId,80);if(!/^[\w-]+$/.test(id)||!/^[\w-]+$/.test(providerId))throw new InputError();
 let url:URL;try{url=new URL(text(s.url,2048))}catch{throw new InputError('invalid_source_url')} if(url.protocol!=='https:'||url.username||url.password||url.hostname.includes('*'))throw new InputError('invalid_source_url');
 if(typeof s.enabled!=='boolean'||!Number.isInteger(s.intervalMinutes)||Number(s.intervalMinutes)<15||Number(s.intervalMinutes)>10080||!['preset:chatgpt','preset:codex','taught'].includes(String(s.parser)))throw new InputError();
 if(!Array.isArray(s.locators)||s.locators.length>8)throw new InputError();
 const ids=new Set<string>();const locators=s.locators.map(raw=>{const l=object(raw);only(l,['id','name','label','css','valueRegex','unit','kind']);
 const id=text(l.id,40);if(!/^[a-zA-Z_]{1,40}$/.test(id)||ids.has(id))throw new InputError();ids.add(id);
 const name=text(l.name,80),label=typeof l.label==='string'&&l.label.length<=120?l.label:'';const css=text(l.css,1000);
 if(l.valueRegex!==VALUE_REGEX||!['percent','credits','CNY','USD','tokens','requests'].includes(String(l.unit))||!['percent_remaining','percent_used','balance','credits','reset'].includes(String(l.kind)))throw new InputError();
 if(String(l.kind).startsWith('percent_')&&l.unit!=='percent'||l.kind==='credits'&&l.unit!=='credits')throw new InputError();
 return {id,name,label,css,valueRegex:VALUE_REGEX,unit:l.unit as Unit,kind:l.kind as Locator['kind']};
 });
 return {id,providerId,label:text(s.label,80),url:url.href,enabled:s.enabled,intervalMinutes:Number(s.intervalMinutes),...(s.useDefaultInterval===undefined?{}:{useDefaultInterval:s.useDefaultInterval}),parser:s.parser as SyncSource['parser'],locators};
}
export function defaultSources(providers:{id:string;type:string;region:string;label:string}[]):SyncSource[] {
 return providers.filter(p=>catalog.some(c=>c.type===p.type&&c.mode==='manual')).flatMap(p=>{
 const source:SyncSource={id:`source-${p.id}`,providerId:p.id,label:p.label,url:officialUrl(p.type,p.region),enabled:false,intervalMinutes:60,useDefaultInterval:true,parser:p.type==='chatgpt'?'preset:chatgpt':'taught',locators:[]};
 return p.type==='chatgpt'?[source,{...source,id:`codex-${p.id}`,label:'Codex',url:'https://chatgpt.com/codex/settings/usage',parser:'preset:codex'}]:p.type==='glm'?[source,{...source,id:`coding-${p.id}`,label:'GLM Coding Plan',url:'https://www.bigmodel.cn/coding-plan/personal/usage'}]:[source];
 });
}
export function parseIngest(value:unknown,now=Date.now()) {
 const b=object(value);only(b,['sourceId','providerId','items','observed_at','status']);
 if(typeof b.sourceId!=='string'||typeof b.providerId!=='string'||!readStates.includes(b.status as ReadState))throw new InputError();
 if(typeof b.observed_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(b.observed_at)||!Number.isFinite(Date.parse(b.observed_at))||new Date(b.observed_at).toISOString()!==b.observed_at||Date.parse(b.observed_at)>now+30000)throw new InputError();
 if(!Array.isArray(b.items)||b.status!=='ok'&&b.items.length)throw new InputError();
 const items=b.status==='ok'?manualItems(b.items,Date.parse(b.observed_at)):[];
 if(b.status==='ok'&&items.some(i=>i.amount===null&&i.resetAt===null))throw new InputError();
 return {sourceId:b.sourceId,providerId:b.providerId,observedAt:b.observed_at,status:b.status as ReadState,items};
}
export function syncAlerts(sources:SyncSource[],statuses:SyncStatus[],devices:Device[],now=Date.now()) {
 const enabled=sources.filter(s=>s.enabled),alerts:{sourceId:string|null;providerId:string|null;state:string;url?:string}[]=[];
 for(const s of enabled){const st=statuses.find(t=>t.sourceId===s.id);
 if(st&&st.status!=='ok')alerts.push({sourceId:s.id,providerId:s.providerId,state:st.status,url:s.url});
 if(!st?.lastSuccess||now-Date.parse(st.lastSuccess)>s.intervalMinutes*120000)alerts.push({sourceId:s.id,providerId:s.providerId,state:'sync_stale',url:s.url});
 }
 if(enabled.length){const interval=Math.min(...enabled.map(s=>s.intervalMinutes));if(!devices.some(d=>!d.revokedAt&&now-(d.lastSeen??d.createdAt)<=interval*120000))alerts.push({sourceId:null,providerId:null,state:'extension_offline'});}
 return alerts;
}

export function parseDefaultInterval(value:unknown):number {if(typeof value!=='number'||!Number.isInteger(value)||value<15||value>10080)throw new InputError();return value}
