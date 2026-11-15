import { describe,it,expect,vi } from 'vitest';
import { fetchQuota, parseSiliconFlow } from '../../server/adapters';
import { fetchSafe, retrySeconds } from '../../server/fetch-safe';
const key='SYNTHETIC_TEST_CREDENTIAL';
const response=(body:unknown,init:ResponseInit={})=>vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body),init));
const cases=[
 ['deepseek','cn',{is_available:true,balance_infos:[{currency:'CNY',total_balance:'110.00',granted_balance:'10.00',topped_up_balance:'100.00'},{currency:'USD',total_balance:'2.0'}]},'110.00','CNY','https://api.deepseek.com/user/balance'],
 ['openrouter_key','cn',{data:{limit:100,usage:25.5,limit_remaining:74.5,limit_reset:'monthly',is_free_tier:false,label:key}},74.5,'USD','https://openrouter.ai/api/v1/key'],
 ['openrouter_credits','cn',{data:{total_credits:100.5,total_usage:25.75}},74.75,'USD','https://openrouter.ai/api/v1/credits'],
 ['moonshot','cn',{code:0,status:true,data:{available_balance:49.5,voucher_balance:46.5,cash_balance:-3}},49.5,'CNY','https://api.moonshot.cn/v1/users/me/balance'],
 ['moonshot','ai',{code:0,data:{available_balance:49.5}},49.5,'USD','https://api.moonshot.ai/v1/users/me/balance'],
] as const;
describe('official API projections',()=>{
 it.each(cases)('%s / %s success',async(type,region,body,amount,unit,url)=>{
  response(body);const result=await fetchQuota(type,region,key);
  expect(result.items[0]).toMatchObject({amount,unit});
  expect(fetch).toHaveBeenCalledWith(url,expect.objectContaining({method:'GET',redirect:'manual',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'}}));
  expect(JSON.stringify(result)).not.toContain(key);
  if(type==='deepseek'){expect(result.facts.available).toBe(true);expect(result.items[3].unit).toBe('USD')}
  if(type==='openrouter_key'){expect(result.facts).toEqual({freeTier:false,limitReset:'monthly'});expect(result.items[0].resetAt).toBeNull()}
 });
 it.each([
  ['deepseek',{balance_infos:[{currency:'CNY'}]}],['openrouter_key',{data:{}}],['openrouter_credits',{data:{}}],['moonshot',{data:{}}]
 ])('%s missing amounts stay null',async(type,body)=>{
  response(body);const result=await fetchQuota(String(type),'cn',key);
  expect(result.items.length).toBeGreaterThan(0);expect(result.items.every(i=>i.amount===null)).toBe(true);
 });
 it('rejects an empty DeepSeek snapshot without inventing an amount or currency',async()=>{response({balance_infos:[]});await expect(fetchQuota('deepseek','cn',key)).rejects.toMatchObject({code:'invalid_response'})});
 it('does not infer OpenRouter remaining from all-time usage',async()=>{response({data:{limit:10,usage:80}});expect((await fetchQuota('openrouter_key','cn',key)).items[0].amount).toBeNull()});
 it.each([401,403,429,500,302])('safe HTTP error %s',async status=>{
  response({message:key},{status,headers:{'Retry-After':'180',Location:'https://evil.invalid/'}});
  await expect(fetchQuota('deepseek','cn',key)).rejects.toMatchObject({code:status===401||status===403?'unauthorized':status===429?'rate_limited':'upstream_error',retryAfter:180});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('enforces the five-second timeout',async()=>{
  vi.useFakeTimers();vi.mocked(fetch).mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')))));
  const request=fetchQuota('deepseek','cn',key);const assertion=expect(request).rejects.toMatchObject({code:'timeout'});
  await vi.advanceTimersByTimeAsync(5000);await assertion;
 });
 it('keeps timeout active during body streaming',async()=>{
  vi.useFakeTimers();vi.mocked(fetch).mockImplementation(async(_url,init)=>new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(new DOMException('timeout','AbortError')))}})));
  const request=fetchQuota('deepseek','cn',key);const assertion=expect(request).rejects.toMatchObject({code:'timeout'});await vi.advanceTimersByTimeAsync(5000);await assertion;
 });
 it.each([true,false])('rejects oversized body, declared=%s',async declared=>{
  vi.mocked(fetch).mockResolvedValue(new Response('x'.repeat(65537),{headers:declared?{'Content-Length':'65537'}:{}}));
  await expect(fetchQuota('deepseek','cn',key)).rejects.toMatchObject({code:'invalid_response'});
 });
 it('rejects invalid JSON and malformed known values',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response('<html>error</html>'));await expect(fetchQuota('moonshot','cn',key)).rejects.toMatchObject({code:'invalid_response'});
  response({data:{available_balance:key}});await expect(fetchQuota('moonshot','cn',key)).rejects.toMatchObject({code:'invalid_response'});
 });
 it.each([['moonshot',{code:1,data:{available_balance:100}}]])('rejects %s business errors',async(type,body)=>{response(body);await expect(fetchQuota(String(type),'cn',key)).rejects.toMatchObject({code:'upstream_error'})});
 it('maps network failures to a fixed upstream error without raw details',async()=>{vi.mocked(fetch).mockRejectedValue(new Error(key));await expect(fetchQuota('deepseek','cn',key)).rejects.toMatchObject({code:'upstream_error',message:'upstream_error'})});
 it('refuses non-allowlisted hosts and regions before sending credentials',async()=>{
  await expect(fetchSafe('https://evil.invalid/',key)).rejects.toMatchObject({code:'invalid_response'});
  await expect(fetchQuota('moonshot','evil.invalid',key)).rejects.toMatchObject({code:'invalid_response'});expect(fetch).not.toHaveBeenCalled();
 });
 it('honours numeric and HTTP-date Retry-After without a 60-second bypass',()=>{
  const now=Date.parse('2026-11-15T00:00:00Z');expect(retrySeconds('2',now)).toBe(60);expect(retrySeconds('Wed, 18 Nov 2026 00:00:00 GMT',now)).toBe(259200);expect(retrySeconds('garbage',now)).toBe(60);
 });
});

describe('SiliconFlow retirement and historical contract',()=>{
 it.each(['cn','com'])('refuses retired %s endpoint without sending a key',async region=>{
  await expect(fetchQuota('siliconflow',region,key)).rejects.toMatchObject({code:'invalid_response'});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['cn','com'] as const)('projects historical %s schema without a network call',region=>{
  const result=parseSiliconFlow({code:20000,data:{totalBalance:'88.88',chargeBalance:'88',balance:'0.88',email:key}},region);
  expect(result.items[0]).toMatchObject({amount:'88.88',unit:region==='cn'?'CNY':'USD'});expect(JSON.stringify(result)).not.toContain(key);expect(fetch).not.toHaveBeenCalled();
 });
 it('historical missing fields remain null and business errors are rejected',()=>{
  expect(parseSiliconFlow({data:{}},'cn').items.every(i=>i.amount===null)).toBe(true);
  expect(()=>parseSiliconFlow({code:401,data:{totalBalance:'100'}},'cn')).toThrow();
 });
});
