import type { ErrorCode } from '../shared/contracts';
import { boundedText } from './security';
export class AdapterError extends Error {constructor(public code: ErrorCode, public retryAfter=60){super(code)}}
const endpoints=new Set([
 'https://api.deepseek.com/user/balance','https://openrouter.ai/api/v1/key','https://openrouter.ai/api/v1/credits',
 'https://api.moonshot.cn/v1/users/me/balance','https://api.moonshot.ai/v1/users/me/balance'
]);
export function retrySeconds(value: string | null, now=Date.now()): number {
 if(!value)return 60;
 const seconds=/^\d+$/.test(value) ? Number(value) : (Date.parse(value)-now)/1000;
 return Number.isFinite(seconds) ? Math.max(60,Math.ceil(seconds)) : 60;
}
export async function fetchSafe(url: string, secret: string): Promise<unknown> {
 if(!endpoints.has(url))throw new AdapterError('invalid_response');
 const controller=new AbortController();let timedOut=false;
 let received=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},5000);
 try {
  const r=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${secret}`,Accept:'application/json'},redirect:'manual',signal:controller.signal});
  received=true;
  if(!r.ok){await r.body?.cancel();throw new AdapterError(r.status===401||r.status===403?'unauthorized':r.status===429?'rate_limited':'upstream_error',retrySeconds(r.headers.get('Retry-After')))}
  const text=await boundedText(r.body,65536,r.headers.get('Content-Length'));
  try{return JSON.parse(text)}catch{throw new AdapterError('invalid_response')}
 }catch(e){
  if(e instanceof AdapterError)throw e;
  throw new AdapterError(timedOut || (e instanceof Error && ['TimeoutError','AbortError'].includes(e.name)) ? 'timeout' : received ? 'invalid_response' : 'upstream_error');
 }finally{clearTimeout(timer)}
}
