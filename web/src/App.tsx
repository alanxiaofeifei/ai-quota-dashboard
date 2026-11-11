import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { api, ApiError, localSession, safeErrorMessage } from './api';
import { captureState, deviceTimeZone, estimatedReset, formatCredits, formatPercent, formatTimestamp } from './format';
import { isProgramManifestFilename, parseSummaryText } from './import';
import type { Account, Snapshot } from './types';

const USAGE_URL = 'https://chatgpt.com/settings/usage?tab=overview';
type Notice = { kind: 'success' | 'error'; text: string } | null;
type Modal = 'create' | 'delete' | 'paste' | null;
type IconName = 'grid' | 'source' | 'layers' | 'refresh' | 'import' | 'plus' | 'lock' | 'arrow' | 'close';

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    source: <><path d="M8 8h8M8 12h8M8 16h5"/><rect x="4" y="2.5" width="16" height="19" rx="2"/></>,
    layers: <><path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1"/></>,
    import: <><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    arrow: <path d="M6 18 18 6M7 6h11v11"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ModalPanel({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (panel.current?.querySelector<HTMLElement>('input, textarea') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('input, textarea, button, a[href]') ?? [])]
      .filter(element => !element.hasAttribute('disabled'));
    const first = focusable[0], last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panel} onKeyDown={onKeyDown}>
      <div className="modal-heading"><h2>{title}</h2><button className="button quiet" type="button" onClick={onClose} aria-label="关闭对话框"><Icon name="close"/></button></div>
      {children}
    </section>
  </div>;
}

function ObservationCards({ snapshot, now, timeZone }: { snapshot: Snapshot; now: number; timeZone: string }) {
  const observation = snapshot.observation;
  const capture = captureState(observation.page_read_at, now);
  const reset = estimatedReset(observation.page_read_at, observation.relative_reset_seconds, now);
  const attention = capture !== 'recent' || reset.state === 'due';
  const badge = capture === 'stale' ? '读取已过期' : capture === 'unknown' ? '时间待确认' : reset.state === 'due' ? '等待重新读取' : '网页观测值';
  const ratio = formatPercent(observation.remaining_percent);
  return <div className="overview-grid">
    <section className={`hero-card${attention ? ' stale-card' : ''}`} aria-labelledby="weekly-title">
      <div className="hero-heading">
        <div><span className="provider-logo" aria-hidden="true">O</span><div><h2 id="weekly-title">Usage 页面周额度</h2><span className="hero-meta">OpenAI 订阅 · 覆盖范围未核对</span></div></div>
        <span className={`pill${attention ? ' warning' : ''}`}>{badge}</span>
      </div>
      <div className="quota-display"><span className="quota-number">{ratio}</span><span className="quota-unit">{ratio === '暂不可用' ? '' : '% 剩余'}</span></div>
      {ratio !== '暂不可用' && <progress className="quota-progress" value={observation.remaining_percent} max={100} aria-label="网页观测的周额度剩余百分比"/>}
      <div className="quota-caption"><span>最近读到的剩余比例</span><span>不代表当前可用状态</span></div>
      <div className="meta-grid">
        <div className="meta-item"><span className="meta-label">页面读取时间</span><span className="meta-value">{formatTimestamp(observation.page_read_at, timeZone)}</span></div>
        <div className="meta-item"><span className="meta-label">重置提示 · 估计</span><span className="meta-value">{reset.text}</span></div>
      </div>
      {attention && <div className="read-again-callout"><p>这份摘要需要重新核对。打开官方页面刷新，用扩展重新读取，再将新摘要粘贴或导入到当前账户。</p><a href={USAGE_URL} target="_blank" rel="noopener noreferrer">打开 Usage 重新读取 <Icon name="arrow" size={13}/></a></div>}
    </section>
    <section className="credits-card" aria-labelledby="credits-title">
      <div className="credits-top"><h2 id="credits-title">订阅 credits</h2><span className="pill muted">独立余额</span></div>
      <p className="credits-balance">{formatCredits(observation.credits_balance)}</p>
      <div className="credits-unit">{observation.credits_balance === null ? '页面未提供或未选中' : 'credits · 最近观测余额'}</div>
      {observation.credits_balance === null && <div className="credits-help"><p>要补充余额，请在 Usage 页面同时选中 <strong>Credits</strong> 和余额，再用扩展读取并导入新摘要。页面没有提供余额时继续保留未知。</p><a href={USAGE_URL} target="_blank" rel="noopener noreferrer">打开 Usage 查看 Credits <Icon name="arrow" size={13}/></a></div>}
      <p className="credits-description">用于符合条件的额外使用。余额为零时，周额度仍按左侧记录单独显示。</p>
      <p className="card-note">订阅 credits 按原单位保留，不换算成 API 余额或美元。</p>
    </section>
  </div>;
}

export function App({ sessionReady }: { sessionReady: Promise<void> }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [label, setLabel] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [timeZone, setTimeZone] = useState('Asia/Taipei');
  const fileInput = useRef<HTMLInputElement>(null);
  const activeAccount = accounts.find(account => account.id === activeId);
  const snapshot = snapshots.find(item => item.account_id === activeId);
  const disabled = loading || fetching || busy !== null || expired;

  function failure(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setExpired(true); setAccounts([]); setSnapshots([]); setActiveId(''); setModal(null);
    }
    setNotice({ kind: 'error', text: safeErrorMessage(error) });
  }

  async function reload(preferred?: string) {
    setFetching(true);
    try {
      const [nextAccounts, nextSnapshots] = await Promise.all([api.accounts(), api.snapshots()]);
      setAccounts(nextAccounts); setSnapshots(nextSnapshots);
      setActiveId(current => {
        const candidate = preferred ?? current;
        return nextAccounts.some(account => account.id === candidate) ? candidate : nextAccounts[0]?.id ?? '';
      });
    } finally { setFetching(false); }
  }

  useEffect(() => {
    let mounted = true;
    sessionReady.then(async () => { if (mounted) await reload(); })
      .catch(error => { if (mounted) failure(error); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // The authorization promise is created once before React renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy('create'); setNotice(null);
    try {
      const account = await api.createAccount(label.trim());
      await reload(account.id);
      setModal(null); setLabel('');
      setNotice({ kind: 'success', text: '本地账户已添加，可以导入网页摘要。' });
    } catch (error) { failure(error); }
    finally { setBusy(null); }
  }

  async function deleteAccount() {
    if (!activeAccount || busy) return;
    const id = activeAccount.id;
    setBusy('delete'); setNotice(null);
    try {
      await api.deleteAccount(id); await reload(); setModal(null);
      setNotice({ kind: 'success', text: '这个账户的本地摘要已删除。' });
    } catch (error) { failure(error); }
    finally { setBusy(null); }
  }

  async function importFile(file?: File) {
    if (!file || !activeAccount || busy) return;
    const id = activeAccount.id;
    setBusy('import'); setNotice(null);
    try {
      const name = file.name.toLowerCase();
      if (['auth.json', 'cookies', 'cookies.sqlite', 'login data'].includes(name) || name.startsWith('.env')) {
        throw new ApiError(400, 'invalid_report');
      }
      if (isProgramManifestFilename(name)) throw new ApiError(400, 'not_quota_summary');
      if (file.size > 32 * 1024) throw new ApiError(400, 'body_too_large');
      const report = parseSummaryText(await file.text());
      await api.importSnapshot(id, report); await reload(id);
      setNotice({ kind: 'success', text: '网页摘要已保存到当前本地账户。读取时间保持原值。' });
    } catch (error) { failure(error); }
    finally { if (fileInput.current) fileInput.current.value = ''; setBusy(null); }
  }

  function openPaste() { setPasteText(''); setPasteError(null); setModal('paste'); }

  async function pasteSummary(event: FormEvent) {
    event.preventDefault();
    if (!activeAccount || busy) return;
    const id = activeAccount.id;
    setBusy('paste'); setPasteError(null); setNotice(null);
    try {
      const report = parseSummaryText(pasteText);
      await api.importSnapshot(id, report); await reload(id);
      setModal(null);
      setNotice({ kind: 'success', text: '网页摘要已保存到当前本地账户。读取时间保持原值。' });
    } catch (error) { setPasteError(safeErrorMessage(error)); if (error instanceof ApiError && error.status === 401) failure(error); }
    finally { setPasteText(''); setBusy(null); }
  }

  async function lock() {
    if (busy) return;
    setBusy('lock');
    try { await api.lock(); setNotice(null); }
    catch (error) { setNotice({ kind: 'error', text: safeErrorMessage(error) }); }
    finally { setExpired(true); setAccounts([]); setSnapshots([]); setActiveId(''); setBusy(null); }
  }

  function closeModal() { if (!busy) { setModal(null); setPasteText(''); setPasteError(null); } }

  return <>
    <div className="app-shell" inert={modal !== null}>
      <aside className="sidebar" aria-label="看板导航">
        <div className="brand"><span className="brand-mark" aria-hidden="true">Q</span>Quota AI</div>
        <p className="brand-caption">YOUR LOCAL OVERVIEW</p>
        <nav>
          <a className="nav-item active" href="#overview" aria-label="额度概览"><Icon name="grid"/>额度概览</a>
          <a className="nav-item" href="#sources" aria-label="数据来源"><Icon name="source"/>数据来源</a>
          <a className="nav-item" href="#platforms" aria-label="平台接入"><Icon name="layers"/>平台接入</a>
        </nav>
        <div className="sidebar-note"><strong>只连接本机</strong>平台页面由你主动读取。<br/>摘要保存在本地账户中。</div>
      </aside>
      <main className="main-content" id="overview">
        <header className="topbar">
          <span className="eyebrow">PERSONAL ALLOWANCE</span>
          <div className="mobile-wordmark"><span className="brand-mark" aria-hidden="true">Q</span>Quota AI</div>
          <div className="header-actions">
            <span className="privacy-pill">摘要保存在本机</span>
            <select className="timezone-select" aria-label="显示时区" value={timeZone} onChange={event => setTimeZone(event.target.value)}>
              <option value="Asia/Taipei">台北时间 · UTC+8</option>
              {deviceTimeZone() !== 'Asia/Taipei' && <option value={deviceTimeZone()}>设备本地时间</option>}
            </select>
            <button className="button quiet" type="button" onClick={lock} disabled={disabled} aria-label="锁定本地看板" title="锁定本地看板"><Icon name="lock"/></button>
          </div>
        </header>
        <section className="intro"><h1>每一份额度，都看得清。</h1><p>查看最近读到的订阅额度，并保留它的来源与时间。</p></section>
        <div className="local-mode-note"><span><strong>本机网站</strong> · 由你打开的程序运行，浏览器扩展负责读取官方页面。</span><a href="#usage-help" onClick={() => setHelpOpen(true)}>使用帮助</a></div>
        {notice && <div className={`status-banner ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
        {expired ? <section className="session-state"><h2>本地看板已锁定</h2><p>此窗口的授权已结束。请从本机程序重新打开已授权的看板窗口。</p><p>这不表示你的 AI 平台登录已经过期。</p></section> : <>
          <div className="workspace-toolbar">
            <div className="account-control"><label className="account-label" htmlFor="account">本地账户</label>
              <select id="account" className="account-select" value={activeId} onChange={event => { setActiveId(event.target.value); setNotice(null); }} disabled={disabled || accounts.length === 0}>
                {accounts.length === 0 && <option value="">尚未添加账户</option>}
                {accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
              <button className="button secondary" type="button" disabled={disabled} onClick={() => { setLabel(''); setModal('create'); }}><Icon name="plus"/>添加本地账户</button>
            </div>
            <div className="toolbar-actions">
              <button className="button quiet" type="button" disabled={disabled} title="只重新载入本机已经保存的记录，不查询 AI 平台" onClick={async () => { setNotice(null); try { await reload(); } catch (error) { failure(error); } }}><Icon name="refresh"/>{fetching ? '正在载入…' : '重载本机记录'}</button>
              <button className="button secondary" type="button" disabled={disabled || !activeAccount} onClick={openPaste}>粘贴摘要</button>
              <button className="button primary" type="button" disabled={disabled || !activeAccount} onClick={() => fileInput.current?.click()}><Icon name="import"/>{busy === 'import' ? '正在导入…' : '导入网页摘要'}</button>
              <input ref={fileInput} className="screenreader-only" tabIndex={-1} type="file" accept="application/json,.json" aria-label="选择网页摘要 JSON" onChange={event => { void importFile(event.target.files?.[0]); }}/>
            </div>
          </div>
          {loading ? <div className="loading-card" role="status">正在读取本地摘要…</div> : snapshot ? <ObservationCards snapshot={snapshot} now={now} timeZone={timeZone}/> : <section className="empty-state">
            <div className="empty-orbit" aria-hidden="true"><Icon name="layers" size={29}/></div>
            <h2 className="empty-title">三步，把额度带到本地看板</h2>
            <p className="empty-copy">数据由你主动读取。尚未导入时，额度保持未知。</p>
            <ol className="setup-steps">
              <li><span className="step-number">1</span><h3>创建本地账户别名</h3><p>取一个方便辨认的名字，用于区分导入的记录；这里不登录 AI 平台。</p>{activeAccount ? <span className="step-done">已创建并选中账户</span> : <button className="button primary" type="button" onClick={() => { setLabel(''); setModal('create'); }} disabled={disabled}><Icon name="plus"/>添加本地账户</button>}</li>
              <li><span className="step-number">2</span><h3>读取官方 Usage 页面</h3><p>刷新页面，选中 <strong>Weekly limit</strong> 的比例、重置提示和 <strong>Credits</strong> 余额，点击读取扩展，再复制或下载摘要。</p><a className="button secondary" href={USAGE_URL} target="_blank" rel="noopener noreferrer">打开官方 Usage<Icon name="arrow" size={13}/></a></li>
              <li><span className="step-number">3</span><h3>将摘要保存到所选账户</h3><p>回到此页粘贴扩展复制的摘要，或选择扩展下载的 JSON 文件。下次更新也按第 2、3 步进行。</p><div className="step-actions"><button className="button primary" type="button" onClick={openPaste} disabled={disabled || !activeAccount}>粘贴摘要</button><button className="button secondary" type="button" onClick={() => fileInput.current?.click()} disabled={disabled || !activeAccount}>导入文件</button></div></li>
            </ol>
            <a href="#usage-help" onClick={() => setHelpOpen(true)}>安装扩展或操作遇到问题？查看使用帮助</a>
          </section>}

          <section id="sources" aria-labelledby="source-title">
            <div className="section-heading"><h2 id="source-title">数据来源</h2>{activeAccount && <button className="button quiet" type="button" onClick={() => setModal('delete')} disabled={disabled}>删除本地账户</button>}</div>
            <div className="source-card"><span className="source-icon"><Icon name="source"/></span>
              <div className="source-copy"><h3>Usage 网页选区</h3><p>你主动读取页面，再导入白名单摘要。</p></div>
              <div className="source-facts">
                <div className="source-fact"><span className="source-label">平台服务端更新时间</span><span className="source-value">未知</span></div>
                <div className="source-fact"><span className="source-label">导入本机时间</span><span className="source-value">{snapshot ? formatTimestamp(snapshot.imported_at, timeZone) : '尚未导入'}</span></div>
                <div className="source-fact"><span className="source-label">刷新方式</span><span className="source-value">用户主动读取</span></div>
              </div>
              <div className="source-warning">账户名称由你指定，尚未校验平台登录身份及共享范围。此记录不能代表所有 ChatGPT 功能或开发者 API 额度。超过 15 分钟的网页观测会标记过期；重新导入不会改变原始读取时间。</div>
            </div>
          </section>
        </>}

        <details id="usage-help" className="usage-help" open={helpOpen} onToggle={event => setHelpOpen(event.currentTarget.open)}>
          <summary>使用帮助 · 安装、读取与更新</summary>
          <div className="help-content">
            <section><h3>看板网站和扩展各做什么？</h3><p>你正在访问程序提供的本机网站，地址以 <code>127.0.0.1</code> 开头，保留程序窗口即可使用。摘要保存在本机，浏览器扩展只负责在你点击时读取官方 Usage 页的选中文字。当前版本不会后台查询平台，也未提供跨设备同步。</p></section>
            <section><h3>Chrome／Edge 应加载哪个目录？</h3><p>在扩展管理页开启开发者模式，选择“加载已解压的扩展程序”，再选择下载包中的 <code>browser-extension</code> 子目录。正确目录里有 <code>manifest.json</code> 和 <code>popup.html</code>；看板可执行文件所在的根目录用于启动程序。</p><p>如果提示缺少扩展名称或无法加载 manifest，请取消后重新选择 <code>browser-extension</code>，不要修改程序的许可或源码清单。已安装可正常读取的扩展可以继续使用。</p></section>
            <section><h3>如何更新、为什么 Credits 显示未知？</h3><p>在官方 Usage 页手动刷新，选中 Weekly limit 的剩余比例、重置提示以及 Credits 的余额，然后点击扩展读取并复制或下载摘要。选择此页对应的本地账户，再粘贴或导入。未选中或页面未提供的余额保持未知，不能当作零。</p><p>“重载本机记录”只读取本机已保存的数据。超过 15 分钟的摘要会标为过期；预计重置到点也需要重新读取，不能据此认定额度已恢复。</p></section>
          </div>
        </details>

        <section id="platforms" aria-labelledby="platform-title">
          <div className="section-heading"><h2 id="platform-title">更多平台</h2><p>逐一核实，逐步接入</p></div>
          <div className="platform-grid">
            {[['G', 'Grok', 'Grok / Grok Bot'], ['✦', 'Gemini', 'Gemini App'], ['A', 'Antigravity', '模型组额度']].map(([icon, name, description]) => <div className="platform-card" key={name}>
              <span className="platform-icon" aria-hidden="true">{icon}</span><div><div className="platform-name">{name}</div><div className="platform-subtitle">{description}</div></div><div className="platform-status">暂未接入</div>
            </div>)}
          </div>
        </section>
        <footer className="footer-note"><p>本地只读原型 · 不会后台查询平台额度</p><p>{localSession.memoryOnly ? '此窗口仅保留临时授权，刷新后可能需要从本机程序重新打开。' : '锁定窗口会清除本地会话授权。'}</p></footer>
      </main>
    </div>
    {modal === 'create' && <ModalPanel title="添加本地账户" onClose={closeModal}>
      <form onSubmit={createAccount}><div className="field"><label className="field-label" htmlFor="account-label">本地账户别名</label><input id="account-label" className="input" value={label} onChange={event => setLabel(event.target.value)} maxLength={40} placeholder="例如：个人账户" autoComplete="off" required disabled={busy !== null}/><p className="field-help">取一个方便辨认的名字，无需密码或平台登录。导入时由你确认摘要属于哪个账户。</p></div><div className="modal-actions"><button className="button secondary" type="button" onClick={closeModal} disabled={busy !== null}>取消</button><button className="button primary" type="submit" disabled={busy !== null || !label.trim()}>{busy === 'create' ? '正在添加…' : '添加账户'}</button></div></form>
    </ModalPanel>}
    {modal === 'paste' && activeAccount && <ModalPanel title="粘贴网页摘要" onClose={closeModal}>
      <form onSubmit={pasteSummary}><p className="paste-destination">保存到本地账户：<strong>{activeAccount.label}</strong></p><div className="field"><label className="field-label" htmlFor="summary-text">扩展复制的摘要 JSON</label><textarea id="summary-text" className="input summary-textarea" value={pasteText} onChange={event => { setPasteText(event.target.value); setPasteError(null); }} maxLength={32769} autoComplete="off" spellCheck={false} placeholder="在这里按 Ctrl+V 粘贴扩展复制的摘要" required disabled={busy !== null}/><p className="field-help">仅粘贴读取扩展生成的额度摘要，最多 32 KiB。此页不会自动读取剪贴板；不要粘贴 Cookie、令牌或聊天内容。</p></div>{pasteError && <p className="paste-error" role="alert">{pasteError}</p>}<div className="modal-actions"><button className="button secondary" type="button" onClick={closeModal} disabled={busy !== null}>取消</button><button className="button primary" type="submit" disabled={busy !== null || !pasteText.trim()}>{busy === 'paste' ? '正在保存…' : '保存摘要'}</button></div></form>
    </ModalPanel>}
    {modal === 'delete' && activeAccount && <ModalPanel title="删除本地账户" onClose={closeModal}>
      <p>将删除「{activeAccount.label}」及其保存在本机的额度摘要。平台账户和订阅不受影响。</p><div className="modal-actions"><button className="button secondary" type="button" onClick={closeModal} disabled={busy !== null}>保留账户</button><button className="button danger" type="button" onClick={deleteAccount} disabled={busy !== null}>{busy === 'delete' ? '正在删除…' : '删除本地记录'}</button></div>
    </ModalPanel>}
  </>;
}
