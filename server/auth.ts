import { boundedText, unbase64 } from './security';
import { object } from '../shared/contracts';
export interface AccessConfig {CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; OWNER_EMAIL?: string}
interface Jwk extends JsonWebKey {kid: string}
interface Cached {keys: Jwk[]; expires: number; unknownRefreshedAt: number}
// Public key material only; isolated by issuer. No session or credential cache.
const caches=new Map<string,Cached>();
const inFlight=new Map<string,Promise<Cached>>();
export function accessConfigured(env: AccessConfig): boolean {
 return typeof env.CF_ACCESS_TEAM_DOMAIN==='string' && /^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(env.CF_ACCESS_TEAM_DOMAIN) &&
 typeof env.CF_ACCESS_AUD==='string' && env.CF_ACCESS_AUD.length>0 && typeof env.OWNER_EMAIL==='string' && /^[^\s@]+@[^\s@]+$/.test(env.OWNER_EMAIL);
}
function decode(s: string): Record<string,unknown> {return object(JSON.parse(new TextDecoder().decode(unbase64(s.replace(/-/g,'+').replace(/_/g,'/')))))}
async function keys(issuer: string, now: number): Promise<Cached> {
 const pending=inFlight.get(issuer);if(pending)return pending;
 const promise=(async()=>{
  const response=await fetch(`${issuer}/cdn-cgi/access/certs`,{redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(!response.ok) {await response.body?.cancel();throw new Error('jwks_unavailable')}
  const data=object(JSON.parse(await boundedText(response.body,65536,response.headers.get('Content-Length'))));
  if(!Array.isArray(data.keys) || data.keys.length>50)throw new Error('invalid_jwks');
  const valid=data.keys.map(object).filter(k=>k.kty==='RSA' && typeof k.kid==='string' && (k.alg===undefined || k.alg==='RS256') && (k.use===undefined || k.use==='sig')).map(k=>({kty:'RSA',kid:String(k.kid),n:typeof k.n==='string'?k.n:undefined,e:typeof k.e==='string'?k.e:undefined,alg:'RS256',use:'sig'}));
  const cached={keys:valid,expires:now+3600000,unknownRefreshedAt:0}; caches.set(issuer,cached);return cached;
 })();
 inFlight.set(issuer,promise);try{return await promise}finally{inFlight.delete(issuer)}
}
export async function verifyAccess(token: string, env: AccessConfig, now=Date.now()): Promise<200|401|403> {
 try {
  if(!accessConfigured(env) || token.length>16384) return 401;
  const parts=token.split('.');if(parts.length!==3 || parts.some(p=>!p || !/^[\w-]+$/.test(p)))return 401;
  const header=decode(parts[0]);if(header.alg!=='RS256' || typeof header.kid!=='string' || !header.kid || header.crit!==undefined)return 401;
  const issuer=`https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  const existing=caches.get(issuer);let cached=existing && existing.expires>now ? existing : await keys(issuer,now);
  let jwk=cached.keys.find(k=>k.kid===header.kid);
  // One bounded refresh per issuer per minute for unknown kids; avoids attacker-driven fetch storms.
  if(!jwk && now-cached.unknownRefreshedAt>=60000) {
   cached.unknownRefreshedAt=now;
   cached=await keys(issuer,now);cached.unknownRefreshedAt=now;
   jwk=cached.keys.find(k=>k.kid===header.kid);
  }
  if(!jwk)return 401;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unbase64(parts[2].replace(/-/g,'+').replace(/_/g,'/')),new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))return 401;
  const p=decode(parts[1]);const seconds=now/1000;
  if(p.iss!==issuer || !(Array.isArray(p.aud) ? p.aud.includes(env.CF_ACCESS_AUD) : p.aud===env.CF_ACCESS_AUD) ||
    typeof p.exp!=='number' || !Number.isFinite(p.exp) || p.exp<=seconds-30 ||
    (p.nbf!==undefined && (typeof p.nbf!=='number' || !Number.isFinite(p.nbf) || p.nbf>seconds+30)))return 401;
  return typeof p.email==='string' && p.email.toLowerCase()===env.OWNER_EMAIL!.toLowerCase() ? 200 : 403;
 }catch{return 401}
}
