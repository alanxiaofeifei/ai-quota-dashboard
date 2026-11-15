import { InputError, object } from '../shared/contracts';
export function base64(bytes: Uint8Array): string {return btoa(String.fromCharCode(...bytes))}
export function unbase64(s: string): Uint8Array<ArrayBuffer> {return Uint8Array.from(atob(s), c=>c.charCodeAt(0))}
async function masterKey(master: string): Promise<CryptoKey> {
 let raw: Uint8Array<ArrayBuffer>;
 try {raw = unbase64(master)} catch {throw new Error('encryption_not_configured')}
 if (raw.length !== 32) throw new Error('encryption_not_configured');
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptSecret(master: string, providerId: string, kind: string, secret: string): Promise<string> {
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`quota:cred:${providerId}:${kind}`)},await masterKey(master),new TextEncoder().encode(secret));
 return JSON.stringify({v:1,iv:base64(iv),data:base64(new Uint8Array(data))});
}
export async function decryptSecret(master: string, providerId: string, kind: string, cipher: string): Promise<string> {
 const c = object(JSON.parse(cipher));
 if (c.v!==1 || typeof c.iv!=='string' || typeof c.data!=='string' || unbase64(c.iv).length!==12) throw new Error('invalid_cipher');
 const data = await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(c.iv),additionalData:new TextEncoder().encode(`quota:cred:${providerId}:${kind}`)},await masterKey(master),unbase64(c.data));
 return new TextDecoder().decode(data);
}
export async function boundedText(body: ReadableStream<Uint8Array> | null, cap: number, length: string | null = null): Promise<string> {
 if (length !== null && Number(length) > cap) {await body?.cancel(); throw new InputError('body_too_large',413)}
 if (!body) return '';
 const reader = body.getReader(); const chunks: Uint8Array[]=[]; let size=0;
 try {
  while (true) {
   const part = await reader.read(); if (part.done) break;
   size += part.value.byteLength;
   if(size>cap) {await reader.cancel();throw new InputError('body_too_large',413)}
   chunks.push(part.value);
  }
 } finally {reader.releaseLock()}
 const all = new Uint8Array(size); let offset=0;
 for(const c of chunks) {all.set(c,offset);offset+=c.length}
 return new TextDecoder('utf-8',{fatal:true}).decode(all);
}
export async function writeBody(request: Request): Promise<Record<string, unknown>> {
 if (request.headers.get('Origin') !== new URL(request.url).origin) throw new InputError('origin_rejected',403);
 if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??'')) throw new InputError('json_required',415);
 const text = await boundedText(request.body,32768,request.headers.get('Content-Length'));
 try {return object(JSON.parse(text))} catch {throw new InputError('invalid_json')}
}
export function secure(response: Response): Response {
 const r=new Response(response.body,response);
 r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 r.headers.set('Cache-Control','private, no-store');r.headers.set('X-Content-Type-Options','nosniff');
 r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Frame-Options','DENY');
 return r;
}
