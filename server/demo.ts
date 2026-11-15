import { catalog } from '../shared/catalog';
import { type Provider, type Snapshot } from '../shared/contracts';
export function demoProviders(now=Date.now()): Provider[] {
 const types=['chatgpt','deepseek','openrouter_key','moonshot','claude','glm','gemini','grok','siliconflow','doubao','qwen'];
 return types.map((type,i)=>{
  const spec=catalog.find(p=>p.type===type)!;const api=spec.mode==='api';
  const source=i===0?'extension':spec.mode;
  const observedAt=new Date(now-(i===4?3*86400000: i===3?7200000:180000)).toISOString();
  const unit=api||type==='siliconflow'?'CNY':'percent';const value=i===1?'118.50':i===2?'14.20':i===3?'49.59':i===5?18:i===9?12:i===0?64:80;
  const snapshot: Snapshot | null=i===7||i===10?null:{items:[{id:type==='siliconflow'?'totalBalance':api?'available_balance':'weekly_percent',label:type==='siliconflow'?'totalBalance':api?'available_balance':'weekly_percent',amount:value,unit:i===2?'USD':unit,resetAt:api||type==='siliconflow'?null:new Date(now+(i===5?-3600000:3*86400000+4*3600000)).toISOString()},
   ...(i===0?[{id:'credits',label:'credits',amount:'12.75',unit:'credits' as const,resetAt:null}]:[])],facts:{},source,observedAt,fetchedAt:observedAt,staleAfter:source==='extension'?900:api?3600:86400};
  return {id:`demo-${type}`,type,label:spec.name,source,region:'cn',nextAllowedFetch:now+60000,
   credential:{configured:api,lastCheckAt:api?now:null,lastCheckStatus:i===3?'rate_limited':api?'ok':'unverified',lastErrorCode:i===3?'rate_limited':null},snapshot};
 });
}
