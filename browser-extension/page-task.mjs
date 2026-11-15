// This self-contained function is injected into the main frame in the isolated
// world. It reads only small, displayed, targeted metric/heading elements.
export function pageTask(action,payload,doc=document,href=location.href){
 const text=el=>{if(!el||['INPUT','TEXTAREA','SCRIPT','STYLE','BODY','HTML'].includes(el.tagName)||el.closest('[hidden],[aria-hidden="true"]'))return null;
 if(typeof el.getClientRects==='function'&&!el.getClientRects().length)return null;
 const style=doc.defaultView?.getComputedStyle?.(el);if(style&&(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'))return null;
 const t=el.innerText??el.textContent;return typeof t==='string'&&t.trim()&&t.length<=512?t.trim():null};
 const cssPath=el=>{const parts=[];for(let n=el;n&&n!==doc.documentElement;n=n.parentElement){const tag=n.tagName.toLowerCase();if(n.id&&/^[\w-]+$/.test(n.id)){parts.unshift(`#${n.id}`);break}const same=[...(n.parentElement?.children??[])].filter(s=>s.tagName===n.tagName);parts.unshift(`${tag}:nth-of-type(${same.indexOf(n)+1})`)}return parts.join(' > ')};
 const labelBefore=el=>{for(let n=el;n&&n!==doc.body;n=n.parentElement){let p=n.previousElementSibling;for(let i=0;p&&i<5;i++,p=p.previousElementSibling){if(p.matches('h1,h2,h3,h4,h5,h6,label,dt,[role="heading"]')){const t=text(p);if(t&&t.length<=120)return t}}}return ''};
 const build=el=>{const value=text(el);if(!value)throw Error('layout_changed');return {label:labelBefore(el),css:cssPath(el),valueRegex:'([+-]?\\d+(?:[.,]\\d+)?)',preview:value}};
 const resolve=l=>{
 // Prefer a nearby exact label to survive inserted siblings; use CSS fallback.
 if(l.label){const headings=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,label,dt,[role="heading"]')].filter(h=>text(h)===l.label);if(headings.length===1){const h=headings[0];let n=h.nextElementSibling;for(let i=0;n&&i<3;i++,n=n.nextElementSibling){if(!n.children.length&&text(n)!==null)return n;const leaves=[...n.querySelectorAll('span,p,strong,b,dd,time,output')].filter(e=>!e.children.length&&text(e)!==null);if(leaves.length===1)return leaves[0]}}}
 try{const els=doc.querySelectorAll(l.css);return els.length===1?els[0]:null}catch{return null}
 };
 if(action==='build')return build(payload);
 if(action==='resolve')return text(resolve(payload));
 let u,e;try{u=new URL(href);e=new URL(payload.url)}catch{return {status:'login_required'}}
 if(u.origin!==e.origin||/(?:^|\/)(?:login|signin|sign-in|auth|oauth|accounts)(?:\/|$)/i.test(u.pathname)||[...doc.querySelectorAll('input[type="password"]')].some(el=>!el.closest('[hidden],[aria-hidden="true"]')&&(typeof el.getClientRects!=='function'||el.getClientRects().length>0)))return {status:'login_required'};
 // A same-origin route change must never read another page (e.g. a chat).
 if(u.pathname!==e.pathname||u.hash!==e.hash)return {status:'layout_changed'};
 if(action==='teach')return new Promise(resolvePromise=>{
 const banner=doc.createElement('div');banner.textContent='AI Quota Sync：请点击单个额度数值（Esc 取消）';Object.assign(banner.style,{position:'fixed',top:'0',left:'0',zIndex:'2147483647',background:'#173528',color:'white',padding:'16px',font:'16px system-ui'});doc.body.append(banner);
 const cleanup=()=>{doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',key,true);banner.remove();clearTimeout(timer)};
 const click=event=>{if(event.target===banner)return;event.preventDefault();event.stopImmediatePropagation();try{const result=build(event.target);cleanup();resolvePromise({status:'candidate',...result})}catch{banner.textContent='请点击更小的、只含额度数值的元素。'}};
 const key=event=>{if(event.key==='Escape'){cleanup();resolvePromise({status:'cancelled'})}};
 const timer=setTimeout(()=>{cleanup();resolvePromise({status:'timeout'})},60000);doc.addEventListener('click',click,true);doc.addEventListener('keydown',key,true);
 });
 if(payload.parser==='taught')return {status:'ok',values:payload.locators.map(l=>text(resolve(l)))};
 // Presets locate known labels then read ONLY one small metric section. They
 // never read body.innerText, chat text, cookies, page storage or requests.
 const sections={};
 for(const [id,re] of [['five_hour_percent',/^(?:5[- ]hour(?:\s+(?:usage(?:\s+limit)?|limit))?|5h(?:\s+limit)?)$/i],['weekly_percent',/^(?:Weekly\s+(?:usage\s+)?limit|Weekly)$/i],['credits',/^Credits$/i]]){
 let targets=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,label,dt,[role="heading"]')];
 // Exact-label XPath locates non-semantic SPA labels without exporting or
 // traversing unrelated page text in JavaScript.
 if(typeof doc.evaluate==='function')for(const label of ['Weekly limit','Weekly','Weekly usage limit','5-hour limit','5 hour limit','5 hour usage limit','5-hour usage limit','5h limit','Credits']){const it=doc.evaluate(`//*[not(self::html or self::body) and normalize-space(text())="${label}"]`,doc,null,5,null);let n;while((n=it.iterateNext()))targets.push(n)}
 const labels=[...new Set(targets)].filter(el=>re.test(text(el)??''));
 if(labels.length!==1)continue;
 const label=labels[0];let el=label.nextElementSibling;if(!el)el=label.parentElement?.nextElementSibling;
 const value=text(el);if(value)sections[id]=value;
 }
 return {status:'ok',sections};
}
