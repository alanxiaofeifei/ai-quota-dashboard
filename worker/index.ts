import { accessConfigured, verifyAccess } from '../server/auth';
import { handleApi, json } from '../server/api';
import { InputError } from '../shared/contracts';
import { AdapterError } from '../server/fetch-safe';
import { handleExtension,extCors } from '../server/extension';
import { secure } from '../server/security';
export interface Env extends Cloudflare.Env {AUTH_MODE?: string; CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; OWNER_EMAIL?: string; MASTER_ENCRYPTION_KEY?: string}
function page(message: string,status: number) {return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quota AI</title><h1>Quota AI</h1><p>${message}</p></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8'}})}
export default {
 async fetch(request: Request,env: Env): Promise<Response> {
  const path=new URL(request.url).pathname;const api=path==='/api'||path.startsWith('/api/');const ext=path.startsWith('/api/ext/');
  const finish=(r:Response)=>secure(ext?extCors(request,r):r);
  try{
   if(path==='/healthz')return finish(json({ok:true}));
   if(!['access','demo'].includes(env.AUTH_MODE??'') || (env.AUTH_MODE==='access'&&!accessConfigured(env)))return finish(api?json({error:'auth_not_configured'},503):page('服务尚未配置。Set AUTH_MODE and Access configuration before use.',503));
   if(ext)return finish(env.AUTH_MODE==='demo'?json({error:'unauthorized'},401):await handleExtension(request,env));
   if(env.AUTH_MODE==='access') {
    const token=request.headers.get('Cf-Access-Jwt-Assertion');const status=token?await verifyAccess(token,env):401;
    if(status!==200)return finish(api?json({error:status===401?'unauthorized':'forbidden'},status):page('请通过 Cloudflare Access 登录授权账户。Sign in through Cloudflare Access.',status));
   }
   const result=api?await handleApi(request,env): ['GET','HEAD'].includes(request.method)?await env.ASSETS.fetch(request):page('Method not allowed',405);
   return finish(result);
  }catch(e){
   if(e instanceof InputError)return finish(json({error:e.code},e.status));
   if(e instanceof AdapterError)return finish(json({error:e.code},e.code==='rate_limited'?429:502,{'Retry-After':String(e.retryAfter)}));
   return finish(api?json({error:'internal_error'},500):page('暂时无法读取。Please try again.',500));
  }
 }
};
