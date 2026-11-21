// This self-contained function is injected into the main frame in the isolated
// world. It reads only small, displayed, targeted metric/heading elements.
export function pageTask(action,payload,doc=document,href=location.href){
 const text=el=>{if(!el||['INPUT','TEXTAREA','SCRIPT','STYLE','BODY','HTML'].includes(el.tagName)||el.closest('[hidden],[aria-hidden="true"]'))return null;
 if(typeof el.getClientRects==='function'&&!el.getClientRects().length)return null;
 const style=doc.defaultView?.getComputedStyle?.(el);if(style&&(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'))return null;
 const t=el.innerText??el.textContent;return typeof t==='string'&&t.trim()&&t.length<=512?t.trim():null};
 const stable=el=>{if(el.id&&/^[a-zA-Z][\w-]*$/.test(el.id)&&!/(?:^_?r_|react|radix|headlessui|[0-9]{4,})/i.test(el.id))return `#${el.id}`;for(const attr of ['data-testid','data-test','aria-label']){const v=el.getAttribute(attr);if(v&&/^[\p{L}\p{N}_ -]{1,80}$/u.test(v))return `${el.tagName.toLowerCase()}[${attr}="${v}"]`}for(const c of el.classList??[]){if(/^[a-z][a-z-]{0,39}$/.test(c)){const css=`${el.tagName.toLowerCase()}.${c}`;if(doc.querySelectorAll(css).length===1)return css}}return ''};
 const numeric=el=>{const v=text(el);return v&&/^(?:(?:US\$|[$¥￥]|USD|CNY)\s*)?[+-]?\d+(?:\.\d+)?\s*(?:%\s*(?:left|remaining|used|剩余|已用)?|credits?|tokens?|requests?|USD|CNY|元|次)?$/i.test(v)};
 const labelBefore=el=>{const aria=el.getAttribute('aria-labelledby');if(aria){const t=text(doc.getElementById(aria));if(t&&t.length<=120)return t}for(let n=el,depth=0;n&&n!==doc.body&&depth<3;n=n.parentElement,depth++){let p=n.previousElementSibling;for(let i=0;p&&i<3;i++,p=p.previousElementSibling){const t=text(p);if(t&&t.length<=120&&!/\d/.test(t)&&!p.children.length)return t;if(p.matches('h1,h2,h3,h4,label,dt,[role="heading"]')&&t&&t.length<=120)return t}}return ''};
 const labelsFor=label=>{
 const targets=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,label,dt,[role="heading"]')];
 if(typeof doc.evaluate==='function'&&!/["']/.test(label)){const it=doc.evaluate(`//*[not(self::html or self::body or self::script or self::style) and normalize-space(text())="${label}"]`,doc,null,5,null);let n;while((n=it.iterateNext()))targets.push(n)}
 else for(const el of doc.querySelectorAll('span,div,dt'))if(!el.children.length&&el.textContent.trim()===label)targets.push(el);
 return [...new Set(targets)].filter(el=>text(el)===label);
 };
 const nearby=(anchor,predicate)=>{let n=anchor.nextElementSibling;for(let i=0;n&&i<3;i++,n=n.nextElementSibling){if(predicate(n))return n;const leaves=[...n.querySelectorAll('span,p,strong,b,dd,time,output')].filter(e=>!e.children.length&&predicate(e));if(leaves.length===1)return leaves[0];if(leaves.length>1)return null}return null};
 const build=el=>{const value=text(el);if(!numeric(el)&&!/^Resets? in /i.test(value??''))throw Error('layout_changed');const label=labelBefore(el),css=stable(el);if(!label&&!css)throw Error('unstable_locator');return {label,css:css||':not(*)',valueRegex:'([+-]?\\d+(?:[.,]\\d+)?)',preview:value}};
 const resolve=l=>{
 if(l.label){const headings=labelsFor(l.label);if(headings.length===1){const n=nearby(headings[0],l.kind==='reset'?el=>/^Resets? in /i.test(text(el)??''):numeric);if(n)return n}if(headings.length>1)return null}
 try{if(/_r_|:nth-/i.test(l.css))return null;const els=doc.querySelectorAll(l.css);return els.length===1?els[0]:null}catch{return null}
 };
 if(action==='build')return build(payload);
 if(action==='resolve')return text(resolve(payload));
 let u,e;try{u=new URL(href);e=new URL(payload.url)}catch{return {status:'login_required'}}
 if(u.origin!==e.origin||/(?:^|\/)(?:login|signin|sign-in|auth|oauth|accounts)(?:\/|$)/i.test(u.pathname)||[...doc.querySelectorAll('input[type="password"]')].some(el=>!el.closest('[hidden],[aria-hidden="true"]')&&(typeof el.getClientRects!=='function'||el.getClientRects().length>0)))return {status:'login_required'};
 // A same-origin route change must never read another page (e.g. a chat).
 if(u.pathname.replace(/\/u\/\d+(?=\/|$)/,'')!==e.pathname.replace(/\/u\/\d+(?=\/|$)/,'')||u.hash!==e.hash)return {status:'layout_changed'};
 if(!['aistudio.google.com','gemini.google.com'].includes(u.hostname)&&u.search!==e.search)return {status:'layout_changed'};
 const account=url=>{const p=url.pathname.match(/\/u\/(\d+)(?:\/|$)/)?.[1],q=url.searchParams.get('authuser');return q!==null&&!/^\d+$/.test(q)||p!==undefined&&q!==null&&p!==q?null:p??q??'0'};
 if(['aistudio.google.com','gemini.google.com'].includes(u.hostname)&&(account(u)===null||account(u)!==account(e)))return {status:'account_mismatch'};
 if(action==='teach')return new Promise(resolvePromise=>{
 const banner=doc.createElement('div');banner.textContent='AI Quota Sync：请点击单个额度数值（Esc 取消）';Object.assign(banner.style,{position:'fixed',top:'0',left:'0',zIndex:'2147483647',background:'#173528',color:'white',padding:'16px',font:'16px system-ui'});doc.body.append(banner);
 const cleanup=()=>{doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',key,true);banner.remove();clearTimeout(timer)};
 const click=event=>{if(event.target===banner)return;event.preventDefault();event.stopImmediatePropagation();try{const result=build(event.target);cleanup();resolvePromise({status:'candidate',...result})}catch(error){banner.textContent=error.message==='unstable_locator'?'此数值缺少稳定标签，请选择带余额名称或 aria 标签的数值（Esc 取消）。':'请选择单个数值；不要选择总额与已用混在一起的整块内容。'}};
 const key=event=>{if(event.key==='Escape'){cleanup();resolvePromise({status:'cancelled'})}};
 const timer=setTimeout(()=>{cleanup();resolvePromise({status:'timeout'})},60000);doc.addEventListener('click',click,true);doc.addEventListener('keydown',key,true);
 });
 if(payload.parser==='taught')return {status:'ok',values:payload.locators.map(l=>text(resolve(l)))};
 // Presets locate known labels then read ONLY one small metric section. They
 // never read body.innerText, chat text, cookies, page storage or requests.
 const sections={};
 const rules={
 five_hour_percent:['5-hour limit','5 hour limit','5 hour usage limit','5-hour usage limit','5h limit','5 小时用量','5小时额度','Current session','当前会话'],
 weekly_percent:['Weekly limit','Weekly','Weekly usage limit','周额度','每周用量','All models','所有模型'],
 credits:['Credits','积分'],
 account_remaining:['Total Credits Available'],
 balance:['当前余额','账户余额','可用余额','账户可用余额','Available Balance','Credit balance','Remaining balance'],
 requests:['Total API Requests','Total requests','请求总数'],tokens:['Total tokens','总 Token 数']
 };
 const parser=payload.parser?.slice(7);
 const allowed=['chatgpt','codex','claude','glm-coding'].includes(parser)?['five_hour_percent','weekly_percent','credits']:parser==='openrouter'?['account_remaining']:['gemini','bailian'].includes(parser)?['requests','tokens']:['balance'];
 for(const id of allowed){
 const anchors=rules[id].flatMap(label=>labelsFor(label));
 if(anchors.length!==1)continue;
 const value=text(nearby(anchors[0],el=>{const v=text(el);return v!==null&&/\d/.test(v)}));if(value)sections[id]=value;
 }
 // A small leaf may contain label and value together, e.g. 当前余额 81.94 元.
 // XPath tests only direct text against known labels, never body/chat text.
 if(typeof doc.evaluate==='function')for(const id of allowed){if(sections[id])continue;const found=[];for(const label of rules[id]){const it=doc.evaluate(`//*[not(*) and not(self::script or self::style) and starts-with(normalize-space(text()),"${label} ")]`,doc,null,5,null);let el;while((el=it.iterateNext())){const v=text(el);if(v)found.push(v.slice(label.length).trim())}}if(found.length===1)sections[id]=found[0]}
 return {status:'ok',sections};
}
