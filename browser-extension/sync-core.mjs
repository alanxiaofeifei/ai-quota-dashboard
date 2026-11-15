// Pure helpers; no account, cookie, storage or network access.
export const VALUE_REGEX='([+-]?\\d+(?:[.,]\\d+)?)';
export function decodePairing(code){
 if(typeof code!=='string'||!/^aiq1\.[\w-]+$/.test(code)||code.length>4096)throw Error('invalid_pairing');
 const raw=code.slice(5).replace(/-/g,'+').replace(/_/g,'/');let p;try{p=JSON.parse(atob(raw))}catch{throw Error('invalid_pairing')}
 if(!p||Object.keys(p).sort().join(',')!=='token,url'||typeof p.token!=='string'||!/^[-\w]{43}$/.test(p.token))throw Error('invalid_pairing');
 const u=new URL(p.url);if(u.protocol!=='https:'||u.origin!==p.url||u.username||u.password||u.hostname.includes('*'))throw Error('invalid_pairing');return {url:u.origin,token:p.token};
}
export function dueSources(sources,last={},now=Date.now()){return sources.filter(s=>s.enabled&&now-(last[s.id]??0)>=Math.max(15,s.intervalMinutes??60)*60000)}
export function loginUrl(url,expected){try{const u=new URL(url),e=new URL(expected);return u.origin!==e.origin||/(?:^|\/)(?:login|signin|sign-in|auth|oauth|accounts)(?:\/|$)/i.test(u.pathname)}catch{return true}}
export function metricValue(text,locator,observedAt=new Date().toISOString()){
 if(typeof text!=='string'||!text.trim()||text.length>512)throw Error('layout_changed');
 if(locator.kind==='reset'){
 const v=text.replace(/^(?:resets?\s+in|重置(?:于|时间)?[:：]?)\s*/i,'').trim();const r=v.match(/^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?$/i);
 let reset;if(r&&r[0]){const seconds=Number(r[1]??0)*86400+Number(r[2]??0)*3600+Number(r[3]??0)*60;if(seconds>366*86400)throw Error('layout_changed');reset=new Date(Date.parse(observedAt)+seconds*1000).toISOString()}else if(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)))reset=new Date(v).toISOString();else throw Error('layout_changed');
 return {id:locator.id,amount:null,unit:locator.unit,resetAt:reset};
 }
 text=text.replace(/\u2212/g,'-');
 if(/\d,\d/.test(text))throw Error('layout_changed');
 if(locator.valueRegex!==VALUE_REGEX)throw Error('layout_changed');
 const values=[...text.matchAll(/[+-]?\d+(?:[.,]\d+)?/g)];if(values.length!==1)throw Error('layout_changed');
 const match=values[0];const shape=text.slice(0,match.index)+'#'+text.slice(match.index+match[0].length);
 if(!/^(?:(?:US\$|[$¥￥]|USD|CNY)\s*)?#\s*(?:%\s*(?:left|remaining|used|剩余|已用)?|credits?|tokens?|requests?|USD|CNY|元|次)?$/i.test(shape.trim()))throw Error('layout_changed');
 const amount=Number(match[0]);if(!Number.isFinite(amount)||locator.unit==='percent'&&(amount<0||amount>100))throw Error('layout_changed');
 return {id:locator.id,amount:locator.kind==='percent_used'?100-amount:amount,unit:locator.unit,resetAt:null};
}
export function parsePresetSections(sections,observedAt){
 const items=[];
 for(const [id,raw] of Object.entries(sections)){
 if(!raw)continue;if(typeof raw!=='string'||raw.length>512)throw Error('layout_changed');const text=raw.replace(/\u2212/g,'-');if(/\d,\d/.test(text))throw Error('layout_changed');
 if(id==='credits'){
 const m=text.match(/^(?:Credits\s*)?(\d+(?:\.\d+)?)\s+credits?\s+remaining$/i);if(!m)throw Error('layout_changed');items.push({id,unit:'credits',amount:Number(m[1]),resetAt:null});continue;
 }
 const matches=[...text.matchAll(/([+-]?\d+(?:\.\d+)?)\s*%\s*(left|remaining|used)/gi)];if(matches.length!==1)throw Error('layout_changed');const m=matches[0],n=Number(m[1]);if(n<0||n>100)throw Error('layout_changed');
 const r=text.match(/Resets\s+in\s+((?:\d+\s*[dhm]\s*)+)/i);let resetAt=null;if(/Resets\s+in/i.test(text)&&!r)throw Error('layout_changed');if(r)resetAt=metricValue(r[1],{id,unit:'percent',kind:'reset'},observedAt).resetAt;
 items.push({id,unit:'percent',amount:m[2].toLowerCase()==='used'?100-n:n,resetAt});
 }
 if(!items.length)throw Error('layout_changed');return items;
}
