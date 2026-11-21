import {permission,dashboard} from './client.mjs';
import {formatValue,countdown,relativeTime,badge,overallState,reasonText} from './island.mjs';
import {matchPreset,samePage,accountIndex} from './presets.mjs';
import {metricValue} from './sync-core.mjs';
const $=id=>document.getElementById(id);let sources=[],candidate,activeTab;
let progress={};
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
 const value=document.createElement('strong');if(p.providerType==='openrouter'&&p.primary?.value==null)value.className='missing-value';value.textContent=p.providerType==='openrouter'&&p.primary?.value==null?'账户余额需要 Management Key':formatValue(p.primary);top.append(name,value);
 const bottom=document.createElement('span');bottom.className='row-bottom';const timer=document.createElement('span');timer.dataset.reset=p.reset_at??'';timer.textContent=countdown(p.reset_at);
 const age=document.createElement('span');age.dataset.lastSync=p.last_sync_at??'';age.textContent=relativeTime(p.last_sync_at);bottom.append(timer,age);
 const b=badge(transportOffline?'offline':p.status);const status=document.createElement('span');status.className=`row-badge ${b.tone}`;status.textContent=b.label;
 const account=document.createElement('span');account.className='account-label';account.textContent=p.accountLabel??'默认账户';const origin=document.createElement('span');origin.className='source-label';origin.textContent=({api:'来源：官方 API',extension:'来源：浏览器页面',manual:'来源：手动'})[p.source]??'';content.append(account,top,bottom,status,origin);if(p.reason){const reason=document.createElement('span');reason.className='row-reason';reason.textContent=reasonText(p.reason);content.append(reason)}row.append(initial,content);root.append(row);if(p.providerType==='openrouter'&&p.primary?.value==null){const a=document.createElement('a');a.className='management-help';a.href='https://openrouter.ai/settings/management-keys';a.target='_blank';a.rel='noreferrer';a.textContent='创建 Management Key ↗（或读取官方 Credits 页）';root.append(a)}
 }
 if(focused)[...root.children].find(row=>row.dataset.providerId===focused)?.focus();
 if(pairing&&!summary.providers.length){const empty=document.createElement('p');empty.className='island-empty';empty.textContent='先在完整看板添加服务商';root.append(empty)}
}
async function refreshSummary(){if(!pairing||refreshing)return;refreshing=true;try{const result=await dashboard('summary');if(!Array.isArray(result.providers))throw Error('摘要响应无效');summary=result;transportOffline=false;renderSummary();await chrome.storage.local.set({summary});$('summary-status').textContent='已更新 · 各单位独立显示'}catch{transportOffline=true;renderSummary();$('summary-status').textContent='暂时离线 · 保留上次成功数值，请重新连接或配对'}finally{refreshing=false}}
chrome.storage.onChanged?.addListener((changes,area)=>{if(area!=='local')return;if(changes.pairing){pairing=changes.pairing.newValue;$('unpaired').hidden=!!pairing;$('current-panel').hidden=!pairing;$('sync').disabled=!pairing;$('connected-host').textContent=pairing?new URL(pairing.url).hostname:'额度一瞥';if(!pairing){summary={providers:[]};progress={};renderProgress();$('open-teach').hidden=true}}if(changes.progress){progress=changes.progress.newValue??{};renderProgress()}if(changes.summary)summary=pairing?(changes.summary.newValue??{providers:[]}):{providers:[]};renderSummary()});
setInterval(()=>{for(const el of document.querySelectorAll('[data-reset]'))el.textContent=countdown(el.dataset.reset);for(const el of document.querySelectorAll('[data-last-sync]'))el.textContent=relativeTime(el.dataset.lastSync)},1000);
setInterval(()=>void refreshSummary(),60000);

$('options').onclick=()=>chrome.runtime.openOptionsPage();
function renderProgress(){const root=$('sync-progress');root.replaceChildren();if(!pairing)return;for(const row of Object.values(progress)){const p=document.createElement('p');p.textContent=`${row.label} · ${row.accountLabel??'默认账户'}：${reasonText(row.status)}`;root.append(p)}}
$('sync').onclick=act(async()=>{$('sync').disabled=true;try{$('summary-status').textContent='正在同步全部已启用来源…';const r=await chrome.runtime.sendMessage({action:'sync'});if(r.error)throw Error(r.error);await refreshSummary();$('summary-status').textContent=`全部同步完成：${r.results?.filter(x=>x.status==='ok').length??0} 个成功，详见逐行结果`}finally{$('sync').disabled=false}});
$('mini').onclick=act(async()=>{const r=await chrome.runtime.sendMessage({action:'mini-window'});if(r.error)throw Error(r.error)});
$('pair-dashboard').onclick=act(async()=>{const url=new URL($('dashboard-url').value);if(url.protocol!=='https:'||url.username||url.password||url.origin!==url.href.replace(/\/$/,''))throw Error('请输入你的看板 HTTPS 根地址');await chrome.tabs.create({url:`${url.origin}/?pair=1`})});
async function discover(){
 const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});activeTab=tabs[0];
 if(activeTab?.url?.startsWith(chrome.runtime.getURL('popup.html'))&&chrome.windows?.getLastFocused){const win=await chrome.windows.getLastFocused({windowTypes:['normal']});activeTab=(await chrome.tabs.query({active:true,windowId:win.id}))[0]}
 const matching=sources.filter(s=>samePage(activeTab?.url,s.url));const known=matchPreset(activeTab?.url);const select=$('current-source');select.replaceChildren();
 for(const s of matching){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.label} · ${s.accountLabel??'默认账户'}`;select.append(o)}
 $('current-source-label').hidden=!matching.length;$('new-account-label').hidden=!!matching.length||!known;$('get-current').disabled=!matching.length;$('add-current').hidden=!!matching.length||!known;
 $('current-hint').textContent=matching.length?'请核对当前登录账户与所选账户；扩展不会读取邮箱或身份。':known?'已识别官方额度页。填写账户标签，添加后即可一键读取。':'请先打开官方额度页。Gemini 应用没有可读余额，请打开 AI Studio 用量页。';
 if(!matching.length&&!known){const a=document.createElement('a');a.href='https://aistudio.google.com/usage';a.target='_blank';a.rel='noreferrer';a.textContent=' 打开 AI Studio 用量页 ↗';$('current-hint').append(a)}
 if(known&&!matching.length)$('new-account').value=known.type==='gemini'?`Google 账户 ${Number(accountIndex(activeTab.url)??0)+1}`:'默认账户';
 $('open-teach').hidden=!pairing||!matching.length;if(matching[0])$('source').value=matching[0].id;
}
$('current-source').onchange=()=>{$('source').value=$('current-source').value};
$('add-current').onclick=act(async()=>{await permission(activeTab.url);const r=await dashboard('config',{addPage:{url:activeTab.url,accountLabel:$('new-account').value.trim()}});const config=await dashboard('config');sources=config.sources;await chrome.storage.local.set({sources});fillSources();await discover();$('current-source').value=r.source.id;$('current-result').textContent='已添加并授权；请点击一键获取当前页数据。'});
$('get-current').onclick=act(async()=>{const s=sources.find(s=>s.id===$('current-source').value);if(!s)throw Error('请选择来源');await permission(s.url);if(!s.enabled){s.enabled=true;await dashboard('config',{sources});await chrome.storage.local.set({sources})}
 $('get-current').disabled=true;try{$('current-result').textContent=`正在读取 ${s.accountLabel??'默认账户'}…`;const r=await chrome.runtime.sendMessage({action:'current',sourceId:s.id,tabId:activeTab.id});if(r.error)throw Error(r.error);$('current-result').textContent=`${s.label} · ${r.result.accountLabel}：${r.result.status==='ok'?r.result.items.map(i=>formatValue({value:i.amount,unit:i.unit})).join(' / '):reasonText(r.result.status)}`;await refreshSummary()}finally{$('get-current').disabled=false}});
function fillSources(){$('source').replaceChildren();for(const s of sources){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.label} · ${s.accountLabel??'默认账户'}`;$('source').append(o)}}
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
 await dashboard('config',{sources});await chrome.storage.local.set({sources});await chrome.storage.local.remove('candidate');$('candidate').hidden=true;$('status').textContent=`已保存：${preview.amount??preview.resetAt} ${unit}；正在同步此来源…`;const result=await chrome.runtime.sendMessage({action:'current',sourceId:s.id,tabId:activeTab.id});if(result.error)throw Error(result.error);$('status').textContent=`已保存 ${s.accountLabel??'默认账户'}：${reasonText(result.result.status)} · ${preview.amount??preview.resetAt} ${unit}`;await refreshSummary();
});
void (async()=>{try{
 const stored=await chrome.storage.local.get(['pairing','summary','sources','candidate','teachStatus','progress']);pairing=stored.pairing;summary=pairing?(stored.summary??{providers:[]}):{providers:[]};sources=stored.sources??[];candidate=stored.candidate;progress=stored.progress??{};renderProgress();
 $('unpaired').hidden=!!pairing;$('current-panel').hidden=!pairing;$('sync').disabled=!pairing;$('connected-host').textContent=pairing?new URL(pairing.url).hostname:'额度一瞥';renderSummary();$('summary-status').textContent=pairing?'显示本机缓存 · 正在更新':'配对码仅保存在本机';
 // Cache is painted before network/config requests or active-tab discovery.
 void refreshSummary();
 if(pairing){try{const config=await dashboard('config');sources=config.sources;await chrome.storage.local.set({sources})}catch{}}
 if(stored.teachStatus){$('status').textContent=stored.teachStatus==='login_required'?'请先重新登录官方页面 / Sign in again':'教学未完成，请重试 / Teaching incomplete; try again';await chrome.storage.local.remove('teachStatus')}
 fillSources();await discover();
 if(candidate){$('source').value=candidate.sourceId;$('candidate').hidden=false;$('preview').textContent=candidate.preview;$('metric-name').value='剩余额度';if(/%.*(?:used|已用)/i.test(candidate.preview))$('kind').value='percent_used';if(/USD|\$/.test(candidate.preview)){$('kind').value='balance';$('unit').value='USD'}else if(/CNY|元|¥|￥/.test(candidate.preview)){$('kind').value='balance';$('unit').value='CNY'}else if(/credits/i.test(candidate.preview)){$('kind').value='credits';$('unit').value='credits'}}
 if(pairing&&(candidate||new URLSearchParams(location.search).get('view')==='teach'))teachView();
 if(!sources.length)$('status').textContent='请先打开设置完成配对 / Pair in Settings first';
}catch{$('summary-status').textContent='请从已安装的扩展打开 / Open installed extension'}})();
