import { describe,it,expect,vi } from 'vitest';
import { encryptSecret,decryptSecret,writeBody,base64 } from '../../server/security';
const master=base64(new Uint8Array(32).fill(7));
describe('credential encryption',()=>{
 it('roundtrips with random 12-byte IVs and never logs key material',async()=>{
  const spies=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];const key='SYNTHETIC_ONLY_NO_REAL_KEY';
  const a=await encryptSecret(master,'provider-a','bearer',key),b=await encryptSecret(master,'provider-a','bearer',key);
  expect(a).not.toBe(b);expect(atob(JSON.parse(a).iv)).toHaveLength(12);expect(a).not.toContain(key);
  expect(await decryptSecret(master,'provider-a','bearer',a)).toBe(key);
  for(const spy of spies)expect(spy).not.toHaveBeenCalled();
  await expect(decryptSecret(master,'provider-b','bearer',a)).rejects.toThrow();await expect(decryptSecret(master,'provider-a','management_bearer',a)).rejects.toThrow();
  await expect(decryptSecret(base64(new Uint8Array(32).fill(8)),'provider-a','bearer',a)).rejects.toThrow();
 });
 it.each(['',base64(new Uint8Array(31)),'invalid base64!'])('rejects invalid master key',async key=>{await expect(encryptSecret(key,'p','bearer','synthetic')).rejects.toThrow('encryption_not_configured')});
});
describe('write guards',()=>{
 const request=(body='{}',headers:Record<string,string>={})=>new Request('https://quota.test/api/providers',{method:'POST',headers:{Origin:'https://quota.test','Content-Type':'application/json',...headers},body});
 it('accepts same-origin JSON',async()=>expect(await writeBody(request('{"x":1}'))).toEqual({x:1}));
 it.each(['https://evil.invalid','null',''])('rejects Origin %s',async origin=>{await expect(writeBody(request('{}',{Origin:origin}))).rejects.toMatchObject({status:403})});
 it('rejects missing Origin',async()=>{await expect(writeBody(new Request('https://quota.test/api/providers',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))).rejects.toMatchObject({status:403})});
 it.each(['text/plain','application/x-www-form-urlencoded','application/jsonx'])('rejects content type %s',async type=>{await expect(writeBody(request('{}',{'Content-Type':type}))).rejects.toMatchObject({status:415})});
 it.each([true,false])('rejects >32KiB, declared=%s',async declared=>{await expect(writeBody(request(' '.repeat(32769),declared?{'Content-Length':'32769'}:{}))).rejects.toMatchObject({status:413})});
 it('counts UTF-8 bytes and rejects malformed JSON',async()=>{
  await expect(writeBody(request(JSON.stringify({text:'额'.repeat(11000)})))).rejects.toMatchObject({status:413});
  await expect(writeBody(request('['))).rejects.toMatchObject({code:'invalid_json'});
 });
});
