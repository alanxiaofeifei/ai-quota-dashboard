import { numeric, object, type Facts, type QuotaItem, type Unit } from '../../shared/contracts';
import { AdapterError, fetchSafe } from '../fetch-safe';
export interface AdapterResult {items: QuotaItem[]; facts: Facts}
export const credentialKind=(type:string,slot='key')=>type==='openrouter_credits'||type==='openrouter'&&slot==='management'?'management_bearer':'bearer';
function item(id: string, value: unknown, unit: Unit): QuotaItem {return {id,label:id,amount:numeric(value),unit,resetAt:null}}
function bool(v: unknown): boolean | null {if(v===undefined || v===null)return null; if(typeof v!=='boolean')throw new AdapterError('invalid_response');return v}
export async function fetchQuota(type: string, region: string, secret: string): Promise<AdapterResult> {
 try {
  if(type==='deepseek') {
   const d=object(await fetchSafe('https://api.deepseek.com/user/balance',secret));
   if(!Array.isArray(d.balance_infos) || d.balance_infos.length<1 || d.balance_infos.length>8)throw new AdapterError('invalid_response');
   const seen=new Set<string>();
   const items=d.balance_infos.flatMap(raw=>{
    const b=object(raw);if((b.currency!=='CNY'&&b.currency!=='USD') || seen.has(b.currency))throw new AdapterError('invalid_response');seen.add(b.currency);
    return [item(`balance_${b.currency}`,b.total_balance,b.currency),item(`granted_${b.currency}`,b.granted_balance,b.currency),item(`topped_up_${b.currency}`,b.topped_up_balance,b.currency)];
   });
   return {items,facts:{available:bool(d.is_available)}};
  }
  if(type==='openrouter_key' || type==='openrouter_credits') {
   let raw;try{raw=await fetchSafe(`https://openrouter.ai/api/v1/${type==='openrouter_key'?'key':'credits'}`,secret)}catch(e){if(e instanceof AdapterError&&e.code==='unauthorized')throw new AdapterError('wrong_key_type');throw e}
   const d=object(object(raw).data);
   if(type==='openrouter_key'&&d.is_management_key===true)throw new AdapterError('wrong_key_type');
   if(type==='openrouter_key') {
    const remaining=item('key_remaining',d.limit_remaining,'USD'); remaining.limit=numeric(d.limit);remaining.used=numeric(d.usage);
    const reset=d.limit_reset;
    if(reset!=null && !['daily','weekly','monthly'].includes(String(reset)))throw new AdapterError('invalid_response');
    return {items:[remaining,item('usage',d.usage,'USD'),item('limit',d.limit,'USD')],facts:{freeTier:bool(d.is_free_tier),limitReset:reset==null?null:reset as 'daily'|'weekly'|'monthly',...(d.limit===null?{keyUnlimited:true}:{})}};
   }
   const total=numeric(d.total_credits), used=numeric(d.total_usage);
   return {items:[item('account_remaining',total===null||used===null?null:Number(total)-Number(used),'USD'),item('total_credits',total,'USD'),item('total_usage',used,'USD')],facts:{}};
  }
  if(type==='moonshot') {
   if(!['cn','ai'].includes(region))throw new AdapterError('invalid_response');
   const r=object(await fetchSafe(`https://api.moonshot.${region}/v1/users/me/balance`,secret));
   if((r.code!==undefined && r.code!==0) || r.status===false)throw new AdapterError('upstream_error');
   const d=object(r.data),unit=region==='ai'?'USD':'CNY';
   return {items:[item('available_balance',d.available_balance,unit),item('voucher_balance',d.voucher_balance,unit),item('cash_balance',d.cash_balance,unit)],facts:{}};
  }
  // SiliconFlow retired /user/info on 2026-08-14. No credentialed calls.
  throw new AdapterError('invalid_response');
 }catch(e){if(e instanceof AdapterError)throw e;throw new AdapterError('invalid_response')}
}

// Historical documented payload projection, retained for contract tests only.
// The catalog and runtime do not call the retired endpoint.
export function parseSiliconFlow(value: unknown,region: 'cn'|'com'): AdapterResult {
 const r=object(value);
 if(r.code!==undefined && r.code!==0 && r.code!==20000)throw new AdapterError('upstream_error');
 const d=object(r.data),unit=region==='com'?'USD':'CNY';
 return {items:[item('totalBalance',d.totalBalance,unit),item('chargeBalance',d.chargeBalance,unit),item('balance',d.balance,unit)],facts:{}};
}

// Unified account primary. Normal-key limits remain explicitly secondary.
export async function fetchOpenRouter(slots:{management?:string;key?:string}):Promise<AdapterResult> {
 const account=slots.management?await fetchQuota('openrouter_credits','cn',slots.management):{items:[item('account_remaining',null,'USD')],facts:{}};
 if(!slots.key)return account;
 const key=await fetchQuota('openrouter_key','cn',slots.key);
 return {items:[...account.items,...key.items],facts:{...account.facts,...key.facts,...(key.facts.keyUnlimited?{keyUnlimited:true}:{})}};
}
