import {permission,dashboard} from './client.mjs';
import {formatValue,countdown,relativeTime,badge,overallState} from './island.mjs';
import {metricValue} from './sync-core.mjs';
const $=id=>document.getElementById(id);let sources=[],candidate;
const act=fn=>async()=>{try{await fn()}catch(e){$('status').textContent=e.message;$('summary-status').textContent=e.message}};
let summary={providers:[]},pairing,transportOffline=false,refreshing=false;
if(new URLSearchParams(location.search).has('mini'))document.body.classList.add('mini-window');
function teachView(){ $('summary-view').hidden=true;$('teach-view').hidden=false;$('back').focus() }
$('open-teach').onclick=teachView;
$('back').onclick=()=>{$('summary-view').hidden=false;$('teach-view').hidden=true;$('dashboard').focus()};
$('pair').onclick=()=>chrome.runtime.openOptionsPage();
$('dashboard').onclick=act(async()=>{if(pairing)await chrome.tabs.create({url:pairing.url});else await chrome.runtime.openOptionsPage()});
function renderSummary(){
 const root=$('provider-list'),focused=document.activeElement?.closest('.provider-row')?.dataset.providerId;root.replaceChildren();
 const state=transportOffline?'offline':overallState(summary.providers);
 $('overall').dataset.state=state;$('overall').setAttribute('aria-label',badge(state).label);
 for(const p of summary.providers){
 const row=document.createElement('button');row.className='provider-row';row.dataset.providerId=p.id;row.title=`打开 ${p.name} 官方页面`;
 row.onclick=act(async()=>{const u=new URL(p.usageUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error('官方页面地址无效');await chrome.tabs.create({url:u.href})});
 const initial=document.createElement('span');initial.className='provider-initial';initial.textContent=p.name.slice(0,1).toUpperCase();
 const content=document.createElement('span');content.className='provider-content';const top=document.createElement('span');top.className='row-top';
 const name=document.createElement('span');name.className='provider-name';name.textContent=p.name;
 const value=document.createElement('strong');value.textContent=formatValue(p.primary);top.append(name,value);
 const bottom=document.createElement('span');bottom.className='row-bottom';const timer=document.createElement('span');timer.dataset.reset=p.reset_at??'';timer.textContent=countdown(p.reset_at);
 const age=document.createElement('span');age.dataset.lastSync=p.last_sync_at??'';age.textContent=relativeTime(p.last_sync_at);bottom.append(timer,age);
 const b=badge(transportOffline?'offline':p.status);const status=document.createElement('span');status.className=`row-badge ${b.tone}`;status.textContent=b.label;
 content.append(top,bottom,status);row.append(initial,content);root.append(row);
 }
 if(focused)[...root.children].find(row=>row.dataset.providerId===focused)?.focus();
 if(pairing&&!summary.providers.length){const empty=document.createElement('p');empty.className='island-empty';empty.textContent='先在完整看板添加服务商';root.append(empty)}
}
async function refreshSummary(){if(!pairing||refreshing)return;refreshing=true;try{const result=await dashboard('summary');if(!Array.isArray(result.providers))throw Error('摘要响应无效');summary=result;transportOffline=false;renderSummary();await chrome.storage.local.set({summary});$('summary-status').textContent='已更新 · 各单位独立显示'}catch{transportOffline=true;renderSummary();$('summary-status').textContent='暂时离线 · 保留上次成功数值，请重新连接或配对'}finally{refreshing=false}}
chrome.storage.onChanged?.addListener((changes,area)=>{if(area!=='local')return;if(changes.pairing){pairing=changes.pairing.newValue;$('unpaired').hidden=!!pairing;$('sync').disabled=!pairing;if(!pairing){summary={providers:[]};$('open-teach').hidden=true}}if(changes.summary)summary=pairing?(changes.summary.newValue??{providers:[]}):{providers:[]};renderSummary()});
setInterval(()=>{for(const el of document.querySelectorAll('[data-reset]'))el.textContent=countdown(el.dataset.reset);for(const el of document.querySelectorAll('[data-last-sync]'))el.textContent=relativeTime(el.dataset.lastSync)},1000);
setInterval(()=>void refreshSummary(),60000);

$('options').onclick=()=>chrome.runtime.openOptionsPage();
$('sync').onclick=act(async()=>{const r=await chrome.runtime.sendMessage({action:'sync'});$('status').textContent=r.error??'同步完成；失败会通知 / Sync complete';$('summary-status').textContent=$('status').textContent;await refreshSummary()});
$('source-page').onclick=act(async()=>{const s=sources.find(s=>s.id===$('source').value);if(s)await chrome.tabs.create({url:s.url})});
$('teach').onclick=act(async()=>{const s=sources.find(s=>s.id===$('source').value);if(!s)throw Error('先在看板添加服务商并更新设置 / Add a provider first');await permission(s.url);const r=await chrome.runtime.sendMessage({action:'teach',sourceId:s.id});if(r.error)throw Error(r.error);window.close()});
$('discard').onclick=act(async()=>{await chrome.storage.local.remove('candidate');$('candidate').hidden=true});
$('kind').onchange=()=>{if($('kind').value.startsWith('percent'))$('unit').value='percent';if($('kind').value==='credits')$('unit').value='credits'};
$('confirm').onclick=act(async()=>{if(!candidate)throw Error('没有预览 / No preview');const s=sources.find(s=>s.id===candidate.sourceId);if(!s)throw Error('来源已移除 / Source removed');
 const name=$('metric-name').value.trim();if(s.locators.length>=8&&!s.locators.some(l=>l.name===name))throw Error('最多 8 个指标 / Maximum 8 metrics');if(!name)throw Error('请输入名称 / Name required');const kind=$('kind').value,unit=$('unit').value;
 const locator={id:`metric_${'abcdefgh'.split('').find(c=>!s.locators.some(l=>l.id===`metric_${c}`))??'a'}`,name,label:candidate.label,css:candidate.css,valueRegex:candidate.valueRegex,kind,unit};
 const preview=metricValue(candidate.preview,locator);if(kind.startsWith('percent')&&unit!=='percent'||kind==='credits'&&unit!=='credits')throw Error('单位不匹配 / Unit mismatch');
 $('preview').textContent=`${preview.amount??preview.resetAt} ${unit}`;
 s.url=candidate.url;s.parser='taught';const existing=s.locators.find(l=>l.name===name);if(existing){locator.id=existing.id;s.locators=s.locators.filter(l=>l.id!==existing.id)}s.locators.push(locator);s.enabled=true;
 await dashboard('config',{sources});await chrome.storage.local.set({sources});await chrome.storage.local.remove('candidate');$('candidate').hidden=true;$('status').textContent='已保存，自动读取已启用 / Saved; automatic reads enabled';await chrome.runtime.sendMessage({action:'sync'});
});
void (async()=>{try{
 const stored=await chrome.storage.local.get(['pairing','summary','sources','candidate','teachStatus']);pairing=stored.pairing;summary=pairing?(stored.summary??{providers:[]}):{providers:[]};sources=stored.sources??[];candidate=stored.candidate;
 $('unpaired').hidden=!!pairing;$('sync').disabled=!pairing;renderSummary();$('summary-status').textContent=pairing?'显示本机缓存 · 正在更新':'配对码仅保存在本机';
 // Cache is painted before network/config requests or active-tab discovery.
 void refreshSummary();
 if(stored.teachStatus){$('status').textContent=stored.teachStatus==='login_required'?'请先重新登录官方页面 / Sign in again':'教学未完成，请重试 / Teaching incomplete; try again';await chrome.storage.local.remove('teachStatus')}
 for(const s of sources){const o=document.createElement('option');o.value=s.id;o.textContent=s.label;$('source').append(o)}
 const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});const tab=tabs[0];
 const match=sources.find(s=>{try{return new URL(s.url).origin===new URL(tab?.url).origin}catch{return false}});
 $('open-teach').hidden=!pairing||!match;if(match)$('source').value=match.id;
 if(candidate){$('source').value=candidate.sourceId;$('candidate').hidden=false;$('preview').textContent=candidate.preview;$('metric-name').value=candidate.label||'额度'}
 if(pairing&&(candidate||new URLSearchParams(location.search).get('view')==='teach'))teachView();
 if(!sources.length)$('status').textContent='请先打开设置完成配对 / Pair in Settings first';
}catch{$('summary-status').textContent='请从已安装的扩展打开 / Open installed extension'}})();
