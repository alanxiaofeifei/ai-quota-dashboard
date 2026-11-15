import { describe,it,expect } from 'vitest';
import { cardState,isStale,manualItems,parseBrowserReport,parseReset,type Provider,type Snapshot } from '../../shared/contracts';
import { demoProviders } from '../../server/demo';
const now=Date.parse('2026-11-15T00:00:00.000Z');
const snapshot:Snapshot={source:'manual',items:[{id:'weekly_percent',label:'weekly_percent',unit:'percent',amount:18,resetAt:'2026-11-14T00:00:00.000Z'}],observedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString(),staleAfter:86400,facts:{}};
const p:Provider={id:'p',type:'chatgpt',label:'Synthetic',source:'manual',region:'cn',nextAllowedFetch:0,credential:{configured:false,lastCheckAt:null,lastCheckStatus:'unverified',lastErrorCode:null},snapshot};
export const report=()=>({schema_version:1,provider:'openai',source:'user_initiated_browser_selection',source_page:'https://chatgpt.com/settings/usage?tab=overview',page_read_at:new Date(now-120000).toISOString(),server_observed_at:null,freshness:'unknown',account:null,provider_pool_id:null,applies_to_products:null,real_account_verified:false,weekly:{window:'weekly',remaining_percent:64,resets_at:null,reset_relative:{label:'untrusted label',seconds:3600,precision:'estimated_from_display'}},credits:{meter_kind:'consumer_credit_balance',balance:'0012.3400',unit:'credits'}});
describe('truth contract',()=>{
 it('reset_due never changes 18 to 100',()=>{expect(cardState(p,now)).toBe('reset_due');expect(p.snapshot!.items[0].amount).toBe(18)});
 it('uses original observed time and strict stale boundary',()=>{const s={...snapshot,staleAfter:900};expect(isStale(s,now+900000)).toBe(false);expect(isStale(s,now+900001)).toBe(true)});
 it('missing and errors never invent 0 or 100',()=>{
  expect(cardState({...p,snapshot:null},now)).toBe('unconfigured');
  expect(cardState({...p,credential:{...p.credential,lastErrorCode:'unauthorized'}},now)).toBe('error_with_cache');expect(p.snapshot!.items[0].amount).toBe(18);
  expect(manualItems([{id:'credits',amount:null,unit:'credits'}],now)).toBeDefined();
 });
 it('keeps null unknown, actual 0 and 100, and different units separate',()=>{
  const result=manualItems([{id:'weekly_percent',amount:null,unit:'percent'},{id:'credits',amount:'0',unit:'credits'},{id:'balance',amount:'100',unit:'USD'}],now);
  expect(result.map(i=>i.amount)).toEqual([null,'0','100']);expect(result.map(i=>i.unit)).toEqual(['percent','credits','USD']);
 });
 it('a zero grant or zero usage does not make a positive balance low',()=>{
  const provider={...p,source:'api' as const,credential:{...p.credential,configured:true},snapshot:{...snapshot,items:[{id:'balance_CNY',label:'balance_CNY',unit:'CNY' as const,amount:'110.00',resetAt:null},{id:'granted_CNY',label:'granted_CNY',unit:'CNY' as const,amount:0,resetAt:null}]}};
  expect(cardState(provider,now)).toBe('healthy');expect(cardState({...provider,credential:{...provider.credential,configured:false}},now)).toBe('unconfigured');
 });
 it('all missing amounts remain unknown and unconfigured',()=>{expect(cardState({...p,snapshot:{...snapshot,items:[{...snapshot.items[0],amount:null}]}},now)).toBe('unconfigured')});
 it('demo covers the six required card states',()=>{const states=new Set(demoProviders(now).map(p=>cardState(p,now)));for(const s of ['healthy','warning','reset_due','stale','error_with_cache','unconfigured'])expect(states.has(s as ReturnType<typeof cardState>)).toBe(true)});
});
describe('manual reset and amount validation',()=>{
 it.each([['3d 4h',273600000],['2h 15m',8100000],['0m',0]])('relative reset %s is absolute at save', (text,delta)=>expect(parseReset(text,now)).toBe(new Date(now+delta).toISOString()));
 it('accepts absolute timezones and null',()=>{expect(parseReset('2026-11-15T08:00:00+08:00',now)).toBe(new Date(now).toISOString());expect(parseReset('',now)).toBeNull()});
 it.each(['tomorrow','-1h','2h 3d','99999d','2026-11-15T08:00:00'])('rejects ambiguous reset %s',value=>expect(()=>parseReset(value,now)).toThrow());
 it.each([-1,101,'NaN',true])('rejects invalid percentage %s',amount=>expect(()=>manualItems([{id:'weekly_percent',unit:'percent',amount}],now)).toThrow());
 it('rejects unknown fields and duplicate metrics',()=>{
  expect(()=>manualItems([{id:'balance',amount:1,unit:'USD',token:'synthetic'}],now)).toThrow();
  expect(()=>manualItems([{id:'credits',amount:1,unit:'credits'},{id:'credits',amount:1,unit:'USD'}],now)).toThrow();
 });
});
describe('existing extension summary whitelist',()=>{
 it('preserves original observation, exact credit decimal, and relative reset anchor',()=>{
  const s=parseBrowserReport(report(),now);expect(s.observedAt).toBe(report().page_read_at);expect(s.staleAfter).toBe(900);expect(s.items[0].resetAt).toBe(new Date(now-120000+3600000).toISOString());expect(s.items[1]).toMatchObject({amount:'0012.3400',unit:'credits'});expect(JSON.stringify(s)).not.toContain('untrusted label');
 });
 it('rejects secrets and unrelated data rather than retaining them',()=>{
  expect(()=>parseBrowserReport({...report(),token:'SYNTHETIC'},now)).toThrow();
  expect(()=>parseBrowserReport({...report(),weekly:{...report().weekly,token:'SYNTHETIC'}},now)).toThrow();
 });
 it('rejects future timestamps, invalid provenance and malformed percentages',()=>{
  for(const change of [{page_read_at:new Date(now+60000).toISOString()},{real_account_verified:true},{account:'private'},{source_page:'https://evil.invalid/'}])expect(()=>parseBrowserReport({...report(),...change},now)).toThrow();
  expect(()=>parseBrowserReport({...report(),weekly:{...report().weekly,remaining_percent:'64'}},now)).toThrow();
 });
});
