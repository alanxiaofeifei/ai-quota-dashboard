import {dueSources,metricValue,parsePresetSections} from './sync-core.mjs';
import {pageTask} from './page-task.mjs';
const get=()=>chrome.storage.local.get(['pairing','sources','last','failures','outbox']);
export async function dashboard(path,body){
 const {pairing}=await get();if(!pairing)throw Error('请先配对 / Pair first');
 const response=await fetch(`${pairing.url}/api/ext/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${pairing.token}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'设备已撤销或配对无效 / Pair again':`同步失败 / Sync failed (${response.status})`);
 return response.json();
}
async function configure(){
 const {sources,defaultIntervalMinutes=60}=await dashboard('config');await chrome.storage.local.set({sources,defaultIntervalMinutes});
 const alarms=await chrome.alarms.getAll();for(const a of alarms)if(a.name.startsWith('source:')&&!sources.some(s=>s.enabled&&`source:${s.id}`===a.name))await chrome.alarms.clear(a.name);
 for(const s of sources.filter(s=>s.enabled)){const name=`source:${s.id}`,periodInMinutes=Math.max(15,s.intervalMinutes);if(!alarms.some(a=>a.name===name&&a.periodInMinutes===periodInMinutes))await chrome.alarms.create(name,{periodInMinutes})}
 return sources;
}
async function reportFailure(source,status){
 const {failures={}}=await get();if(failures[source.id]!==status){if(status!=='ok')await chrome.notifications.create(`source:${source.id}`,{type:'basic',iconUrl:'icon.png',title:`AI Quota Sync · ${source.label}`,message:({login_required:'登录已过期，请重新登录。',layout_changed:'需要重新教学：页面已变化。',timeout:'读取超时。',network:'同步失败，请检查网络。'})[status]??'同步失败',buttons:[{title:status==='layout_changed'?'打开页面并重新教学':'打开官方页面'}]});failures[source.id]=status;await chrome.storage.local.set({failures})}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function readSource(source){
 let tab,owned=false,ownedWindow;let status='network',items=[];let observed_at=new Date().toISOString();
 try{
 if(!await chrome.permissions.contains({origins:[`${new URL(source.url).origin}/*`]}))throw Error('network');
 const existing=(await chrome.tabs.query({})).find(t=>t.url===source.url);
 if(existing)tab=existing;else { // Separate minimized window avoids activating a user's working tab.
 try{const win=await chrome.windows.create({url:source.url,focused:false,state:'minimized',type:'normal'});ownedWindow=win.id;tab=win.tabs?.[0]}catch{tab=await chrome.tabs.create({url:source.url,active:false})}owned=true;
 }
 if(!tab?.id)throw Error('network');const loadDeadline=Date.now()+20000;
 while((await chrome.tabs.get(tab.id)).status!=='complete'){if(Date.now()>loadDeadline)throw Error('timeout');await sleep(400)}
 const deadline=Date.now()+20000;
 while(true){
 const current=await chrome.tabs.get(tab.id);const u=new URL(current.url);const expected=new URL(source.url);
 if(u.protocol!=='https:'){status='network';break}
 if(u.origin!==expected.origin||/(?:^|\/)(?:login|signin|sign-in|auth|oauth|accounts)(?:\/|$)/i.test(u.pathname)){status='login_required';break}
 const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:pageTask,args:['read',source]}))[0]?.result;
 if(result?.status==='login_required'){status='login_required';break}
 try{
 observed_at=new Date().toISOString();if(result?.status!=='ok')throw Error('layout_changed');
 items=source.parser==='taught'?source.locators.map((l,i)=>metricValue(result.values[i],l,observed_at)):parsePresetSections(result.sections,observed_at);
 if(!items.length)throw Error('layout_changed');status='ok';break;
 }catch{if(Date.now()>deadline){status='layout_changed';items=[];break}await sleep(500)}
 }
 }catch(error){status=['timeout','login_required','layout_changed'].includes(error.message)?error.message:'network';items=[]}
 finally{if(owned&&tab?.id)await chrome.tabs.remove(tab.id).catch(()=>{});if(ownedWindow)await chrome.windows.remove(ownedWindow).catch(()=>{})}
 const {last={}}=await get();last[source.id]=Date.now();await chrome.storage.local.set({last});
 const payload={sourceId:source.id,providerId:source.providerId,items:status==='ok'?items:[],observed_at,status};
 const {outbox={}}=await get();
 try{await dashboard('ingest',payload);delete outbox[source.id]}catch{status='network';outbox[source.id]={...payload,status:'network',items:[]}}
 await chrome.storage.local.set({outbox});
 await reportFailure(source,status);
}
let running=false;
export async function tick(force=false){if(running)return;running=true;try{const sources=await configure();await dashboard('heartbeat',{});const {outbox={}}=await get();for(const [id,payload] of Object.entries(outbox)){try{await dashboard('ingest',payload);delete outbox[id]}catch{}}await chrome.storage.local.set({outbox});const {last={}}=await get();for(const s of (force?sources.filter(s=>s.enabled):dueSources(sources,last)))await readSource(s);await chrome.storage.local.set({summary:await dashboard('summary')})}catch{await chrome.action.setBadgeText({text:'!'});await chrome.action.setBadgeBackgroundColor({color:'#b84a4a'});return}finally{running=false}await chrome.action.setBadgeText({text:''})}
let openingMini;
export function openMiniWindow(){
 if(openingMini)return openingMini;
 openingMini=(async()=>{const url=chrome.runtime.getURL('popup.html?mini=1');const existing=(await chrome.tabs.query({})).find(t=>t.url===url);if(existing){await chrome.windows.update(existing.windowId,{focused:true,state:'normal'});return}await chrome.windows.create({url,type:'popup',width:380,height:560,focused:true})})().finally(()=>{openingMini=undefined});
 return openingMini;
}
chrome.commands?.onCommand.addListener(command=>{if(command==='open-mini-window')void openMiniWindow().catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>{void chrome.alarms.create('heartbeat',{periodInMinutes:15});void tick()});
chrome.runtime.onStartup.addListener(()=>{void chrome.alarms.create('heartbeat',{periodInMinutes:15});void tick()});
chrome.alarms.onAlarm.addListener(()=>void tick());
chrome.notifications.onButtonClicked.addListener(async id=>{const {sources=[]}=await get();const s=sources.find(s=>`source:${s.id}`===id);if(s)await chrome.tabs.create({url:s.url});await chrome.notifications.clear(id)});
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
 const run=async()=>{
 if(message.action==='mini-window'){await openMiniWindow();return {ok:true}}
 if(message.action==='sync'){await tick(true);return {ok:true}}
 if(message.action==='teach'){
 const {sources=[]}=await get();const source=sources.find(s=>s.id===message.sourceId);if(!source)throw Error('请选择来源 / Choose source');
 let tab=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
 if(tab?.url?.startsWith(chrome.runtime.getURL('popup.html'))){tab=(await chrome.tabs.query({})).find(t=>t.url===source.url);if(tab?.id)await chrome.tabs.update(tab.id,{active:true})}if(!tab?.id||new URL(tab.url).origin!==new URL(source.url).origin)throw Error('请先打开来源的官方页面 / Open source page first');
 // Return immediately so the popup can close and the user can click the page.
 void chrome.scripting.executeScript({target:{tabId:tab.id},func:pageTask,args:['teach',{...source,url:tab.url}]}).then(async results=>{const result=results[0]?.result;if(result?.status==='candidate')await chrome.storage.local.set({candidate:{sourceId:source.id,url:tab.url,...result}});else await chrome.storage.local.set({teachStatus:result?.status??'network'})}).catch(()=>chrome.storage.local.set({teachStatus:'network'}));
 return {ok:true};
 }
 throw Error('unknown_action');
 };run().then(reply,error=>reply({error:error.message}));return true;
});
