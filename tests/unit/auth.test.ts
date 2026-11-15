import { beforeAll,describe,it,expect,vi } from 'vitest';
import { verifyAccess } from '../../server/auth';
import worker, { type Env } from '../../worker/index';
import { base64 } from '../../server/security';
let pair:CryptoKeyPair,jwk:JsonWebKey;
const b64url=(s:string)=>base64(new TextEncoder().encode(s)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
beforeAll(async()=>{pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);jwk=await crypto.subtle.exportKey('jwk',pair.publicKey)});
function config(){return {CF_ACCESS_TEAM_DOMAIN:`test-${crypto.randomUUID()}.cloudflareaccess.com`,CF_ACCESS_AUD:'synthetic-audience',OWNER_EMAIL:'owner@example.invalid'}}
async function token(env: ReturnType<typeof config>,claims:Record<string,unknown>={},header:Record<string,unknown>={}) {
 const now=Math.floor(Date.now()/1000);const h=b64url(JSON.stringify({alg:'RS256',kid:'first',...header})),p=b64url(JSON.stringify({iss:`https://${env.CF_ACCESS_TEAM_DOMAIN}`,aud:[env.CF_ACCESS_AUD],exp:now+3600,nbf:now-1,email:'OWNER@example.invalid',...claims}));
 const s=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(`${h}.${p}`));return `${h}.${p}.${base64(new Uint8Array(s)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
}
function mockKeys(kid='first'){vi.mocked(fetch).mockResolvedValue(Response.json({keys:[{...jwk,kid}]}))}
describe('Cloudflare Access JWT',()=>{
 it('accepts valid RS256, audience array, and case-insensitive owner',async()=>{const env=config();mockKeys();expect(await verifyAccess(await token(env),env)).toBe(200);expect(fetch).toHaveBeenCalledWith(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,expect.objectContaining({redirect:'manual'}))});
 it.each([
  [{aud:['wrong']},401],[{iss:'https://wrong.cloudflareaccess.com'},401],[{exp:1},401],[{exp:'9999999999'},401],
  [{nbf:9999999999},401],[{nbf:'1'},401],[{email:'other@example.invalid'},403],[{email:null},403]
 ])('rejects invalid claims %j',async(claims,status)=>{const env=config();mockKeys();expect(await verifyAccess(await token(env,claims),env)).toBe(status)});
 it('applies only 30 seconds of clock skew',async()=>{const env=config(),now=Math.floor(Date.now()/1000);mockKeys();expect(await verifyAccess(await token(env,{exp:now-29,nbf:now+29}),env)).toBe(200);expect(await verifyAccess(await token(env,{exp:now-31}),env)).toBe(401)});
 it.each(['none','HS256','RS512'])('rejects algorithm %s before fetching keys',async alg=>{const env=config();expect(await verifyAccess(await token(env,{}, {alg}),env)).toBe(401);expect(fetch).not.toHaveBeenCalled()});
 it('rejects forged signatures',async()=>{const env=config();mockKeys();const valid=await token(env);expect(await verifyAccess(valid.slice(0,-20)+'AAAAAAAAAAAAAAAAAAAA',env)).toBe(401)});
 it('caches JWKS one hour and refreshes once for an unknown kid',async()=>{
  const env=config();mockKeys();expect(await verifyAccess(await token(env),env)).toBe(200);expect(await verifyAccess(await token(env),env)).toBe(200);expect(fetch).toHaveBeenCalledTimes(1);
  mockKeys('rotated');expect(await verifyAccess(await token(env,{}, {kid:'rotated'}),env)).toBe(200);expect(fetch).toHaveBeenCalledTimes(2);
  expect(await verifyAccess(await token(env,{}, {kid:'missing'}),env)).toBe(401);expect(fetch).toHaveBeenCalledTimes(2);
  const later=Date.now()+3600001;mockKeys('first');expect(await verifyAccess(await token(env,{exp:Math.floor(later/1000)+3600}),env,later)).toBe(200);expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('refreshes once on an initially unknown kid',async()=>{const env=config();vi.mocked(fetch).mockResolvedValueOnce(Response.json({keys:[{...jwk,kid:'old'}]})).mockResolvedValueOnce(Response.json({keys:[{...jwk,kid:'first'}]}));expect(await verifyAccess(await token(env),env)).toBe(200);expect(fetch).toHaveBeenCalledTimes(2)});
 it('fails closed on JWKS errors or invalid team domains',async()=>{const env=config();vi.mocked(fetch).mockRejectedValue(new Error('network'));expect(await verifyAccess(await token(env),env)).toBe(401);expect(await verifyAccess(await token(env),{...env,CF_ACCESS_TEAM_DOMAIN:'evil.invalid/path'})).toBe(401)});
});
describe('Worker auth boundaries',()=>{
 function bindings(mode?:string,access=config()):Env {return {...access,AUTH_MODE:mode,DB:{} as D1Database,ASSETS:{fetch:vi.fn(async()=>new Response('asset')),connect:()=>{throw new Error('unused')}}}}
 it.each([undefined,'password','invalid'])('fails closed for AUTH_MODE=%s except health',async mode=>{
  const env=bindings(mode);
  for(const path of ['/','/api/overview','/assets/main.js'])expect((await worker.fetch(new Request(`https://quota.test${path}`),env)).status).toBe(503);
  expect((await worker.fetch(new Request('https://quota.test/healthz'),env)).status).toBe(200);expect(env.ASSETS.fetch).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('gates HTML, API, and static assets in access mode',async()=>{
  const env=bindings('access');for(const path of ['/','/api/overview','/assets/main.js']){
   const r=await worker.fetch(new Request(`https://quota.test${path}`),env);expect(r.status).toBe(401);expect(r.headers.get('Content-Type')).toContain(path.startsWith('/api')?'application/json':'text/html');
   expect(r.headers.get('Cache-Control')).toContain('no-store');expect(r.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  }expect(env.ASSETS.fetch).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('requires complete Access configuration',async()=>{const env=bindings('access');delete env.CF_ACCESS_AUD;expect((await worker.fetch(new Request('https://quota.test/'),env)).status).toBe(503)});
 it('serves assets only after valid owner verification',async()=>{const env=bindings('access');mockKeys();expect((await worker.fetch(new Request('https://quota.test/assets/main.js',{headers:{'Cf-Access-Jwt-Assertion':await token(env as ReturnType<typeof config>)}}),env)).status).toBe(200);expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)});
 it('demo returns all states and rejects all writes without outbound fetch',async()=>{
  const env=bindings('demo');const r=await worker.fetch(new Request('https://quota.test/api/overview'),env);expect(r.status).toBe(200);const body=await r.json() as {providers:unknown[]};expect(body.providers.length).toBeGreaterThanOrEqual(10);
  for(const path of ['/api/refresh','/api/providers','/api/providers/test','/api/providers/fake/credential']){
   const result=await worker.fetch(new Request(`https://quota.test${path}`,{method:'POST',headers:{Origin:'https://quota.test','Content-Type':'application/json'},body:'{}'}),env);expect(result.status).toBe(403);expect(await result.text()).toContain('demo_read_only');
  }
  expect(fetch).not.toHaveBeenCalled();
 });
});
