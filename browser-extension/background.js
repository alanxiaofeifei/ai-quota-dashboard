import {dueSources,metricValue,parsePresetSections} from './sync-core.mjs';
import {samePage,sourceForPage} from './presets.mjs';
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
// Chrome storage has no compare-and-swap. Serialize local map updates while
// up to three independent pages load, so account progress cannot overwrite it.
let storageUpdates=Promise.resolve();
function updateLocal(key,update){const result=storageUpdates.then(async()=>{const data=await chrome.storage.local.get(key),value=data[key]??{};await update(value);await chrome.storage.local.set({[key]:value})});storageUpdates=result.catch(()=>{});return result}
async function reportFailure(source,status){
 await updateLocal('failures',async failures=>{if(failures[source.id]===status)return;
 if(status!=='ok')await chrome.notifications.create(`source:${source.id}`,{type:'basic',iconUrl:'icon.png',title:`AI Quota Sync · ${source.label}`,message:({login_required:'登录已过期，请重新登录。',layout_changed:'需要重新教学：页面已变化。',timeout:'读取超时。',network:'同步失败，请检查网络。',permission_required:'需授权：在扩展点获取当前页并允许此网站。',account_mismatch:'账户地址不匹配，请核对账户。',no_data:'本页没有可识别的额度数字，请核对页面或使用教学。'})[status]??'同步失败',buttons:[{title:status==='layout_changed'?'打开页面并重新教学':'打开官方页面'}]}).catch(()=>{});
 failures[source.id]=status});
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function readSource(source,activeTab,blockedStatus){
 let tab,owned=false,ownedWindow;let status='network',items=[];let observed_at=new Date().toISOString();
 try{
 if(blockedStatus)throw Error(blockedStatus);
 if(!await chrome.permissions.contains({origins:[`${new URL(source.url).origin}/*`]}))throw Error('permission_required');
 const existing=(await chrome.tabs.query({})).find(t=>samePage(t.url,source.url));
 if(activeTab){if(!samePage(activeTab.url,source.url))throw Error('account_mismatch');tab=activeTab}else if(existing)tab=existing;else { // Separate minimized window avoids activating a user's working tab.
 try{const win=await chrome.windows.create({url:source.url,focused:false,state:'minimized',type:'normal'});ownedWindow=win.id;tab=win.tabs?.[0]}catch{tab=await chrome.tabs.create({url:source.url,active:false})}owned=true;
 }
 if(!tab?.id)throw Error('network');const loadDeadline=Date.now()+20000;
 while((await chrome.tabs.get(tab.id)).status!=='complete'){if(Date.now()>loadDeadline)throw Error('timeout');await sleep(400)}
 const deadline=Date.now()+20000;
 while(true){
 const current=await chrome.tabs.get(tab.id);const u=new URL(current.url);const expected=new URL(source.url);
 if(u.protocol!=='https:'){status='network';break}
 if(u.origin!==expected.origin||/(?:^|\/)(?:login|signin|sign-in|auth|oauth|accounts)(?:\/|$)/i.test(u.pathname)){status='login_required';break}
 if(!samePage(current.url,source.url)){status='account_mismatch';break}
 const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:pageTask,args:['read',source]}))[0]?.result;
 if(['login_required','account_mismatch'].includes(result?.status)){status=result.status;break}
 try{
 observed_at=new Date().toISOString();if(result?.status!=='ok')throw Error('layout_changed');
 items=source.parser==='taught'?source.locators.map((l,i)=>metricValue(result.values[i],l,observed_at)):parsePresetSections(result.sections,observed_at,source.parser);
 if(!items.length)throw Error('layout_changed');status='ok';break;
 }catch{if(Date.now()>deadline){status=source.parser==='taught'?'layout_changed':'no_data';items=[];break}await sleep(500)}
 }
 }catch(error){status=['timeout','login_required','layout_changed','permission_required','account_mismatch'].includes(error.message)?error.message:'network';items=[]}
 finally{if(owned&&tab?.id)await chrome.tabs.remove(tab.id).catch(()=>{});if(ownedWindow)await chrome.windows.remove(ownedWindow).catch(()=>{})}
 await updateLocal('last',last=>{last[source.id]=Date.now()});
 const payload={sourceId:source.id,providerId:source.providerId,items:status==='ok'?items:[],observed_at,status};
 let uploaded=false;
 try{await dashboard('ingest',payload);uploaded=true}catch{status='network'}
 await updateLocal('outbox',outbox=>{if(uploaded)delete outbox[source.id];else outbox[source.id]={...payload,status:'network',items:[]}});
 await reportFailure(source,status);
 const result={sourceId:source.id,providerId:source.providerId,label:source.label,accountLabel:source.accountLabel??'默认账户',status,items:status==='ok'?items:[]};
 await updateLocal('progress',progress=>{progress[source.id]=result});return result;
}
let running=false;
export async function tick(force=false){if(running)throw Error('同步正在进行，请稍候');running=true;try{
 const sources=await configure();await dashboard('heartbeat',{});const {outbox={}}=await get();for(const [id,payload] of Object.entries(outbox)){try{await dashboard('ingest',payload);delete outbox[id]}catch{}}await chrome.storage.local.set({outbox});
 const {last={}}=await get();const selected=force?sources.filter(s=>s.enabled):dueSources(sources,last);if(force)await chrome.storage.local.set({progress:Object.fromEntries(selected.map(s=>[s.id,{sourceId:s.id,label:s.label,accountLabel:s.accountLabel??'默认账户',status:'pending'}]))});
 const results=Array(selected.length);let next=0;
 await Promise.all(Array.from({length:Math.min(3,selected.length)},async()=>{while(next<selected.length){const index=next++,s=selected[index];await updateLocal('progress',progress=>{progress[s.id]={sourceId:s.id,label:s.label,accountLabel:s.accountLabel??'默认账户',status:'reading'}});const ambiguous=sources.some(other=>other.enabled&&other.providerId!==s.providerId&&samePage(other.url,s.url));results[index]=await readSource(s,undefined,ambiguous?'account_mismatch':undefined)}}));
 await chrome.storage.local.set({summary:await dashboard('summary')});await chrome.action.setBadgeText({text:''});return {results};
 }catch(error){await chrome.action.setBadgeText({text:'!'});await chrome.action.setBadgeBackgroundColor({color:'#b84a4a'});throw error}finally{running=false}}
export async function currentPage(sourceId,tabId){
 if(running)throw Error('同步正在进行，请稍候');running=true;try{
 const sources=await configure(),tab=await chrome.tabs.get(tabId);const matches=sources.filter(s=>samePage(tab.url,s.url));
 const source=sourceId?matches.find(s=>s.id===sourceId):sourceForPage(sources,tab.url);if(!source)throw Error(matches.length>1?'多个账户使用相同地址，请选择来源并核对当前登录账户':'请先将当前官方额度页添加为来源');if(!source.enabled)throw Error('来源未启用，请在设置中启用');
 const result=await readSource(source,tab);await chrome.storage.local.set({summary:await dashboard('summary')});return result;
 }finally{running=false}}
let openingMini;
export function openMiniWindow(){
 if(openingMini)return openingMini;
 openingMini=(async()=>{const url=chrome.runtime.getURL('popup.html?mini=1');const existing=(await chrome.tabs.query({})).find(t=>t.url===url);if(existing){await chrome.windows.update(existing.windowId,{focused:true,state:'normal'});return}await chrome.windows.create({url,type:'popup',width:440,height:640,focused:true})})().finally(()=>{openingMini=undefined});
 return openingMini;
}
chrome.commands?.onCommand.addListener(command=>{if(command==='open-mini-window')void openMiniWindow().catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>{void chrome.alarms.create('heartbeat',{periodInMinutes:15});void tick().catch(()=>{})});
chrome.runtime.onStartup.addListener(()=>{void chrome.alarms.create('heartbeat',{periodInMinutes:15});void tick().catch(()=>{})});
chrome.alarms.onAlarm.addListener(()=>void tick().catch(()=>{}));
chrome.notifications.onButtonClicked.addListener(async id=>{const {sources=[]}=await get();const s=sources.find(s=>`source:${s.id}`===id);if(s)await chrome.tabs.create({url:s.url});await chrome.notifications.clear(id)});
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
 const run=async()=>{
 if(message.action==='mini-window'){await openMiniWindow();return {ok:true}}
 if(message.action==='sync')return {ok:true,...await tick(true)};
 if(message.action==='current')return {ok:true,result:await currentPage(message.sourceId,message.tabId)};
 if(message.action==='teach'){
 const {sources=[]}=await get();const source=sources.find(s=>s.id===message.sourceId);if(!source)throw Error('请选择来源 / Choose source');
 let tab=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
 if(tab?.url?.startsWith(chrome.runtime.getURL('popup.html'))){tab=(await chrome.tabs.query({})).find(t=>t.url===source.url);if(tab?.id)await chrome.tabs.update(tab.id,{active:true})}if(!tab?.id||!samePage(tab.url,source.url))throw Error('请先打开来源的官方页面 / Open source page first');
 // Return immediately so the popup can close and the user can click the page.
 void chrome.scripting.executeScript({target:{tabId:tab.id},func:pageTask,args:['teach',{...source,url:tab.url}]}).then(async results=>{const result=results[0]?.result;if(result?.status==='candidate')await chrome.storage.local.set({candidate:{sourceId:source.id,url:tab.url,...result}});else await chrome.storage.local.set({teachStatus:result?.status??'network'})}).catch(()=>chrome.storage.local.set({teachStatus:'network'}));
 return {ok:true};
 }
 throw Error('unknown_action');
 };run().then(reply,error=>reply({error:error.message}));return true;
});
