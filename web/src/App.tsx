import { useEffect, useRef, useState, type FormEvent } from 'react';
import { catalog, fieldsFor, officialUrl, preset, providerLinks, keyGuidance } from '../../shared/catalog';
import { cardState, isStale, type Provider, type QuotaItem } from '../../shared/contracts';
import { zh } from '../../shared/locales/zh-CN';
import { en } from '../../shared/locales/en';
import { syncAlerts } from '../../shared/extension';
import { SyncDialog,type SyncConfig } from './SyncDialog';
import { api, ApiError } from './api';
import { amount, duration, timestamp } from './format';
type Overview={mode:string;providers:Provider[]};
type Modal={kind:'add'|'key'|'manual'|'account';provider?:Provider};
export function App() {
 const [locale,setLocale]=useState(()=>localStorage.getItem('quota-lang')==='en'?'en':'zh-CN');
 const [theme,setTheme]=useState(()=>localStorage.getItem('quota-theme')==='light'?'light':'dark');
 const [data,setData]=useState<Overview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[modal,setModal]=useState<Modal|null>(null),[now,setNow]=useState(Date.now());
 const [syncOpen,setSyncOpen]=useState(()=>new URLSearchParams(location.search).get('pair')==='1'),[sync,setSync]=useState<SyncConfig>({sources:[],devices:[],statuses:[]});
 const alerts=syncAlerts(sync.sources,sync.statuses,sync.devices,now);
 const loadSync=async()=>setSync(await api<SyncConfig>('/api/extension'));
 useEffect(()=>{void loadSync().catch(()=>{});const timer=setInterval(()=>{void loadSync().catch(()=>{});void load().catch(()=>{})},30000);return()=>clearInterval(timer)},[]);
 const text=locale==='en'?en:zh;const t=(key:string)=>text[key as keyof typeof text]??key;
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('quota-theme',theme)},[theme]);
 useEffect(()=>{document.documentElement.lang=locale;document.title=`Quota AI · ${text.title}`;localStorage.setItem('quota-lang',locale)},[locale,text.title]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer)},[]);
 const load=async()=>{const result=await api<Overview>('/api/overview');setData(result);return result};
 useEffect(()=>{let alive=true;void (async()=>{
  try{const result=await api<Overview>('/api/overview');if(!alive)return;setData(result);
   if(result.mode!=='demo' && result.providers.some(p=>preset(p.type).mode==='api'&&p.credential.configured&&isStale(p.snapshot)&&p.nextAllowedFetch<=Date.now())){
    setBusy(true);try{const refreshed=await api<{providers:Provider[]}>('/api/refresh',{});if(alive)setData({...result,providers:refreshed.providers})}finally{if(alive)setBusy(false)}
   }
  }catch(e){if(alive)setError(e instanceof ApiError?e.code:'internal_error')}
 })();return ()=>{alive=false}},[]);
 async function refresh(id?:string) {
  if(data?.mode==='demo'){setNotice('demo_read_only');return}
  setBusy(true);setError('');try{const result=await api<{providers:Provider[]}>('/api/refresh',id?{id}:{});setData(d=>d?{...d,providers:result.providers}:d)}catch(e){setError(e instanceof ApiError?e.code:'internal_error')}finally{setBusy(false)}
 }
 const providers=data?.providers??[];const needsAttention=(p:Provider)=>cardState(p,now)!=='healthy'||alerts.some(a=>a.providerId===p.id||a.state==='extension_offline'&&sync.sources.some(s=>s.enabled&&s.providerId===p.id));const attention=providers.filter(needsAttention).length;
 const filtered=providers.slice().sort((a,b)=>a.type.localeCompare(b.type)||(a.accountLabel??'默认账户').localeCompare(b.accountLabel??'默认账户')).filter(p=>filter==='all'||filter==='attention'&&needsAttention(p)||filter==='api'&&preset(p.type).mode==='api'||filter==='subscription'&&preset(p.type).mode==='manual');
 const apiCount=providers.filter(p=>preset(p.type).mode==='api').length;
 return <div className="shell">
  <header className="topbar"><a href="/" className="brand" aria-label="Quota AI"><span className="brand-icon">q<span>·</span></span><span>Quota<span className="brand-light"> AI</span><small>PERSONAL ALLOWANCE</small></span></a>
   <div className="top-actions"><span className="instance"><i/>{data?.mode==='demo'?text.demo:text.private}</span><button className="icon-button" onClick={()=>setLocale(locale==='en'?'zh-CN':'en')} aria-label={locale==='en'?'切换中文':'Switch to English'}>{locale==='en'?'中文':'EN'}</button><button className="icon-button" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={theme==='dark'?text.light:text.dark}>{theme==='dark'?'☼':'☾'}</button></div>
  </header>
  <main><section className="intro"><div><p className="eyebrow">{text.eyebrow} <span>/ 01</span></p><h1>{text.headline}</h1><p className="subtitle">{text.subtitle}</p></div><div className="intro-actions"><button className="secondary" disabled={busy} onClick={()=>void refresh()}><span className={busy?'spin':''}>↻</span> {text.refresh}</button><button className="secondary" onClick={()=>setSyncOpen(true)}>{text.connectExtension}</button><button className="primary" onClick={()=>setModal({kind:'add'})}>＋ {text.add}</button></div></section>
   {data?.mode==='demo'&&<aside className="demo-banner"><span className="badge">DEMO</span><p>{text.demoNote}</p><span className="demo-spark">✧</span></aside>}
   {alerts.length>0&&<aside className="alert" role="alert"><strong>{text.syncAttention}</strong>{alerts.map((a,i)=><p key={i}>{sync.sources.find(s=>s.id===a.sourceId)?.label} · {t(a.state)} {a.url&&<a href={a.url} target="_blank" rel="noopener noreferrer">{a.state==='login_required'?text.relogin:text.reteach} ↗</a>}</p>)}<button onClick={()=>setSyncOpen(true)}>{text.connectExtension}</button></aside>}
   <section className="summary"><div><span className="summary-dot"/><strong>{attention}</strong> {text.need}<span className="divider">/</span>{providers.length} {text.providers}</div><span>{apiCount} {text.apiCount} <span className="divider">·</span> {providers.length-apiCount} {text.subCount}</span></section>
   <nav className="filters" aria-label={text.title}>{['all','attention','api','subscription'].map(f=><button key={f} aria-pressed={filter===f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{t(f)}<span>{f==='all'?providers.length:f==='attention'?attention:f==='api'?apiCount:providers.length-apiCount}</span></button>)}</nav>
   {error&&<div className="alert" role="alert">{t(error)} <button onClick={()=>{setError('');void load().catch(()=>setError('internal_error'))}}>{text.retry}</button></div>}
   {notice&&<div className="notice" role="status">{t(notice)}<button aria-label={text.close} onClick={()=>setNotice('')}>×</button></div>}
   {!data&&!error&&<p className="empty">{text.loading}</p>}
   {data&&!filtered.length&&<p className="empty">{providers.length?text.noResults:text.empty}</p>}
   <section className="grid" aria-label={text.title}>{filtered.map(p=>{
    const state=cardState(p,now),spec=preset(p.type),items=p.snapshot?.items??[],first=items[0];const cardAlerts=alerts.filter(a=>a.providerId===p.id||a.state==='extension_offline'&&sync.sources.some(s=>s.enabled&&s.providerId===p.id));
    const observed=p.snapshot?Date.parse(p.snapshot.observedAt):null;
    const age=observed===null?text.unknown:now-observed<60000?text.now:`${duration(now-observed)} ${text.age}`;
    return <article key={p.id} className={`card ${state}`}><div className="card-heading"><div className={`provider-icon provider-${p.type}`}>{p.type==='chatgpt'?'◎':p.type==='claude'?'✳':p.type==='gemini'?'✦':p.label.charAt(0)}</div><div className="provider-heading"><h2>{p.label}</h2><small>{p.accountLabel??'默认账户'}</small><p>{spec.mode==='api'?'API':text.subscription}{spec.regions?` · ${p.region.toUpperCase()}`:''}</p></div><span className="source-badge">{p.source==='api'?'API':t(p.source)}</span></div>
     <div className="state-line"><span className="state-dot"/>{t(state)}<span className="age" title={p.snapshot?`${timestamp(p.snapshot.observedAt,locale)} / ${timestamp(p.snapshot.observedAt,locale,Intl.DateTimeFormat().resolvedOptions().timeZone)}`:''}>{age}</span></div>
     <div className="main-metric"><strong>{p.type==='openrouter'&&(!first||first.amount===null)?text.accountUnavailable:first?amount(first,locale):'—'}</strong><span>{first&&first.amount!==null?(first.unit==='percent'?text.remaining:first.unit):text.unknown}</span></div>
     {p.type==='openrouter'&&(!first||first.amount===null)&&<p className="help">{text.addManagement} <a href="https://openrouter.ai/settings/management-keys" target="_blank" rel="noopener noreferrer">Management Key ↗</a></p>}
     {sync.sources.some(s=>s.providerId===p.id)&&!sync.sources.some(s=>s.providerId===p.id&&s.enabled)&&<p className="card-error">{locale==='en'?'Automatic sources are disabled':'未启用：请在扩展设置中启用来源'}</p>}{cardAlerts.map((a,i)=><p className="card-error" key={i}>{t(a.state)}</p>)}
     <p className="metric-label">{first?t(first.label):text.notConfigured}</p>
     {first?.unit==='percent'&&first.amount!==null&&<div className="progress" role="progressbar" aria-label={t(first.label)} aria-valuenow={Number(first.amount)} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${Number(first.amount)}%`}}/></div>}
     <div className="details">{items.slice(1).map(i=><div key={i.id}><span>{t(i.label)}</span><strong>{p.type==='openrouter'&&p.snapshot?.facts.keyUnlimited&&['limit','key_remaining'].includes(i.id)?text.unlimited:amount(i,locale)}{['percent','USD','CNY'].includes(i.unit)?'':` ${i.unit}`}</strong>{i.resetAt&&<small title={timestamp(i.resetAt,locale)}>{now>=Date.parse(i.resetAt)?text.resetDue:`${text.reset} · ${duration(Date.parse(i.resetAt)-now)}`}</small>}</div>)}
      {p.snapshot?.facts.available!=null&&<div><span>{p.snapshot.facts.available?text.available:text.unavailable}</span></div>}
      {p.snapshot?.facts.freeTier!=null&&<div><span>{text.freeTier}</span><strong>{p.snapshot.facts.freeTier?'✓':'—'}</strong></div>}
      {p.snapshot?.facts.limitReset&&<div><span>{text.recurrence}</span><strong>{t(p.snapshot.facts.limitReset)}</strong></div>}
     </div>
     <div className={`reset-line ${state==='reset_due'?'due':''}`}>{first?.resetAt?<><span>◷</span> {now>=Date.parse(first.resetAt)?text.resetDue:`${text.reset} · ${duration(Date.parse(first.resetAt)-now)}`}<time title={timestamp(first.resetAt,locale,Intl.DateTimeFormat().resolvedOptions().timeZone)}>{timestamp(first.resetAt,locale)}</time></>:<span className="muted">{text.noReset}</span>}</div>
     {p.credential.lastErrorCode&&<p className="card-error">{t(p.credential.lastErrorCode)}</p>}
     <div className="card-actions"><button onClick={()=>setModal({kind:'account',provider:p})}>{locale==='en'?'Account label':'账户标签'}</button>{spec.mode==='api'?<><button disabled={busy||(data?.mode!=='demo'&&p.nextAllowedFetch>now)} onClick={()=>void refresh(p.id)}>{data?.mode!=='demo'&&p.nextAllowedFetch>now?`${text.cooldown} ${duration(p.nextAllowedFetch-now)}`:`↻ ${text.refresh}`}</button><button onClick={()=>setModal({kind:'key',provider:p})}>{text.manage}</button></>:<button onClick={()=>setModal({kind:'manual',provider:p})}>{text.update} <span>↗</span></button>}<a href={p.usageUrl??officialUrl(p.type,p.region)} target="_blank" rel="noopener noreferrer" aria-label={`${p.label} ${text.official}`}>{text.official} ↗</a>{spec.extraUsageUrl&&<a href={spec.extraUsageUrl} target="_blank" rel="noopener noreferrer">{p.type==='glm'?'Coding Plan':p.type==='chatgpt'?'Codex':'API'} ↗</a>}</div>
    </article>
   })}</section>
   <footer><span className="footer-mark">q.</span><p>{text.footer}</p><span>Asia/Taipei · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></footer>
  </main>
  {syncOpen&&<SyncDialog providers={providers} en={locale==='en'} demo={data?.mode==='demo'} onClose={()=>setSyncOpen(false)} onSaved={loadSync}/>}
  {modal&&<Editor modal={modal} locale={locale} demo={data?.mode==='demo'} onClose={()=>setModal(null)} onSaved={async()=>{setNotice('saved');await load()}}/>}
 </div>;
}
function Editor({modal,locale,demo,onClose,onSaved}:{modal:Modal;locale:string;demo:boolean;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const text=locale==='en'?en:zh,t=(s:string)=>text[s as keyof typeof text]??s;
 const dialog=useRef<HTMLDialogElement>(null),keyInput=useRef<HTMLInputElement>(null);
 const [type,setType]=useState(modal.provider?.type??'deepseek'),[region,setRegion]=useState(modal.provider?.region??'cn'),[label,setLabel]=useState(modal.provider?.label??'');
 const [slot,setSlot]=useState('management');
 const [accountLabel,setAccountLabel]=useState(modal.provider?.accountLabel??'默认账户'),[pageOnly,setPageOnly]=useState(false);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<QuotaItem[]|null>(null),[summary,setSummary]=useState('');
 const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries((modal.provider?.snapshot?.items??[]).map(i=>[i.id,i.amount===null?'':String(i.amount)])));
 const [resets,setResets]=useState<Record<string,string>>(()=>Object.fromEntries((modal.provider?.snapshot?.items??[]).map(i=>[i.id,i.resetAt??''])));
 const spec=preset(type);const manual=modal.kind==='manual';
 useEffect(()=>{const d=dialog.current;d?.showModal();return ()=>{d?.close()}},[]);
 async function action(fn:()=>Promise<void>) {if(demo){setError('demo_read_only');if(keyInput.current)keyInput.current.value='';return}setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof ApiError?e.code:'invalid_input')}finally{setBusy(false)}}
 async function save(e: FormEvent) {e.preventDefault();await action(async()=>{
  if(modal.kind==='account'){await api(`/api/providers/${modal.provider!.id}/account`,{accountLabel})}else if(manual) {
   const items=fieldsFor(type,region).map(f=>({id:f.id,unit:f.unit,amount:values[f.id]?.trim()||null,resetAt:resets[f.id]||null}));
   await api(`/api/providers/${modal.provider!.id}/manual`,{items});
  }else if(modal.kind==='key')await api(`/api/providers/${modal.provider!.id}/credential`,{key:keyInput.current?.value??'',...(type==='openrouter'?{slot}:{})});
  else await api('/api/providers',{type,region,label:label||spec.name,accountLabel,...(pageOnly&&spec.mode==='api'?{pageOnly:true}:spec.mode==='api'?{key:keyInput.current?.value??'',...(type==='openrouter'?{slot}:{})}:{})});
  if(keyInput.current)keyInput.current.value='';await onSaved();onClose();
 })}
 return <dialog ref={dialog} className={manual?'drawer':''} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="editor-title"><div className="dialog-header"><div><p className="eyebrow">QUOTA AI / {manual?'OBSERVATION':'PROVIDER'}</p><h2 id="editor-title">{manual?text.update:modal.kind==='key'?text.manage:modal.kind==='account'?(locale==='en'?'Account label':'账户标签'):text.add}</h2></div><button className="icon-button" type="button" aria-label={text.close} onClick={onClose}>×</button></div>
  <form onSubmit={e=>void save(e)}>
   {modal.kind==='add'?<><label>{text.provider}<select value={type} onChange={e=>{setType(e.target.value);setRegion('cn');setPreview(null);if(keyInput.current)keyInput.current.value=''}}>{catalog.map(p=><option key={p.type} value={p.type}>{p.name} · {p.mode==='api'?'API':text.manual}</option>)}</select></label><label>{text.label}<input maxLength={80} value={label} placeholder={spec.name} onChange={e=>setLabel(e.target.value)}/></label></>:<p className="editor-provider">{modal.provider?.label}</p>}
   {(modal.kind==='add'||modal.kind==='account')&&<label>{locale==='en'?'Account label':'账户标签（例如 Google 个人 / Google 工作）'}<input maxLength={80} required value={accountLabel} onChange={e=>setAccountLabel(e.target.value)}/></label>}
   {modal.kind==='add'&&spec.mode==='api'&&<label className="check-label"><input type="checkbox" checked={pageOnly} onChange={e=>setPageOnly(e.target.checked)}/>{locale==='en'?'Read official page with extension (no API key)':'通过扩展读取官方页面（无需 API Key）'}</label>}
   {!manual&&modal.kind!=='account'&&spec.regions&&<label>{text.region}<select disabled={modal.kind==='key'} value={region} onChange={e=>{setRegion(e.target.value);setPreview(null);if(keyInput.current)keyInput.current.value=''}}>{spec.regions.map(r=><option key={r}>{r}</option>)}</select></label>}
   {!manual&&modal.kind!=='account'&&<div className="help"><p>{keyGuidance(type,locale==='en')}</p><a href={officialUrl(type,region)} target="_blank" rel="noopener noreferrer">{text.official} ↗</a> · {providerLinks(type,region).keyUrl&&<><a href={providerLinks(type,region).keyUrl} target="_blank" rel="noopener noreferrer">{text.createKey} ↗</a> · </>}<a href={providerLinks(type,region).docsUrl} target="_blank" rel="noopener noreferrer">{text.docs} ↗</a>{spec.extraUsageUrl&&<> · <a href={spec.extraUsageUrl} target="_blank" rel="noopener noreferrer">{type==='glm'?'Coding Plan':type==='chatgpt'?'Codex':'API'} ↗</a></>}</div>}
   {!manual&&modal.kind!=='account'&&type==='siliconflow'&&<p className="help">{text.retiredApi}</p>}{!manual&&modal.kind!=='account'&&spec.mode==='api'&&!pageOnly&&<><p className="help">{text.keyNote}</p>{type==='openrouter'&&<label>{text.keySlot}<select value={slot} onChange={e=>{setSlot(e.target.value);setPreview(null);if(keyInput.current)keyInput.current.value=''}}><option value="management">Management Key</option><option value="key">{text.normalKey}</option></select><a href={slot==='management'?'https://openrouter.ai/settings/management-keys':'https://openrouter.ai/settings/keys'} target="_blank" rel="noopener noreferrer">{text.createKey} ↗</a></label>}
    <label>{text.key}<input ref={keyInput} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required maxLength={4096} onChange={()=>setPreview(null)}/></label>
    {modal.provider&&type==='openrouter'&&<p className="help">Management Key: {modal.provider.credentialSlots?.includes('management')?text.configured:text.notConfigured} · Key: {modal.provider.credentialSlots?.includes('key')?text.configured:text.notConfigured}</p>}
    {modal.provider&&<p className="help">{modal.provider.credential.configured?text.configured:text.notConfigured}{modal.provider.credential.lastCheckAt&&<> · {text.lastCheck}: {timestamp(modal.provider.credential.lastCheckAt,locale)} · {t(modal.provider.credential.lastCheckStatus)}</>}</p>}
    <button className="secondary full" type="button" disabled={busy} onClick={()=>void action(async()=>{const result=await api<{preview:{items:QuotaItem[]}}>('/api/providers/test',{type,region,key:keyInput.current?.value??'',...(type==='openrouter'?{slot}:{})});setPreview(result.preview.items)})}>{text.test}</button>
    {preview&&<div className="preview"><h3>{text.preview}</h3>{preview.map(i=><p key={i.id}>{t(i.label)} <strong>{amount(i,locale)} {i.unit==='credits'?'credits':''}</strong></p>)}</div>}
   </>}
   {manual&&<><p className="help">{text.manualNote}</p>{type==='siliconflow'&&<p className="help">{text.retiredApi}</p>}{fieldsFor(type,region).map(f=><fieldset key={f.id}><legend>{t(f.id)} · {f.unit==='percent'?'%':f.unit}</legend><label>{t(f.id)}<input inputMode="decimal" value={values[f.id]??''} onChange={e=>setValues({...values,[f.id]:e.target.value})} placeholder="—"/></label><label>{text.resetInput}<input value={resets[f.id]??''} onChange={e=>setResets({...resets,[f.id]:e.target.value})} placeholder="3d 4h"/></label><label className="date-label">{text.dateInput}<input type="datetime-local" onChange={e=>{if(e.target.value)setResets({...resets,[f.id]:new Date(e.target.value).toISOString()})}}/></label></fieldset>)}
    {type==='chatgpt'&&<section className="import-section"><h3>{text.importTitle}</h3><p className="help">{text.importNote}</p><label>{text.importTitle}<textarea rows={5} maxLength={32768} value={summary} onChange={e=>setSummary(e.target.value)}/></label><button className="secondary" type="button" disabled={busy} onClick={()=>void action(async()=>{let report;try{report=JSON.parse(summary)}catch{throw new ApiError('invalid_json')}await api(`/api/providers/${modal.provider!.id}/import`,{report});setSummary('');await onSaved();onClose()})}>{text.importButton}</button></section>}
   </>}
   {error&&<p className="alert" role="alert">{t(error)}</p>}
   <div className="dialog-actions">{modal.kind==='key'&&<button className="danger" type="button" disabled={busy} onClick={()=>void action(async()=>{await api(`/api/providers/${modal.provider!.id}/credential`,{clear:true,...(type==='openrouter'?{slot}:{})});if(keyInput.current)keyInput.current.value='';await onSaved();onClose()})}>{text.clear}</button>}<button type="button" className="secondary" onClick={onClose}>{text.cancel}</button><button className="primary" disabled={busy} type="submit">{!manual&&modal.kind!=='account'&&spec.mode==='api'&&!pageOnly?text.saveKey:text.save}</button></div>
  </form>
 </dialog>;
}
