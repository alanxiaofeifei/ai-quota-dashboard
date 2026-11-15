import type { Account, Snapshot } from './types';

const knownErrors = new Set([
  'invalid_label', 'invalid_report', 'invalid_arguments', 'older_snapshot', 'snapshot_conflict',
  'account_not_found', 'not_found', 'invalid_json', 'body_too_large', 'future_observation',
  'unauthorized', 'session_expired', 'invalid_bootstrap', 'bootstrap_expired', 'storage_failed',
  'invalid_browser_report', 'invalid_read_time', 'invalid_account_label',
  'request_too_large',
]);

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super('request_failed'); }
}

export const LOCAL_SESSION_KEY = 'ai-quota-session';
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);

// Only this application's short-lived request verifier is retained. Platform
// credentials and quota/account data are never stored in browser storage.
export class LocalSession {
  private token: string | null = null;
  private persistent = false;
  constructor(private readonly storage?: SessionStorage) {
    try {
      const saved = storage?.getItem(LOCAL_SESSION_KEY);
      if (validToken(saved)) this.token = saved;
      this.persistent = storage !== undefined;
    } catch { this.persistent = false; }
  }
  get value(): string | null { return this.token; }
  get memoryOnly(): boolean { return !this.persistent; }
  set(value: string): void {
    if (!validToken(value)) throw new ApiError(502, 'invalid_response');
    this.token = value;
    try { this.storage?.setItem(LOCAL_SESSION_KEY, value); }
    catch { this.persistent = false; }
  }
  clear(): void {
    this.token = null;
    try { this.storage?.removeItem(LOCAL_SESSION_KEY); }
    catch { this.persistent = false; }
  }
}

function availableSessionStorage(): SessionStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; }
  catch { return undefined; }
}
export const localSession = new LocalSession(availableSessionStorage());

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (localSession.value && !(path === '/session' && options.method === 'POST')) {
      headers.set('X-AI-Quota-Session', localSession.value);
    }
    response = await fetch(`/api${path}`, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers,
    });
  } catch { throw new ApiError(0, 'local_service_unavailable'); }
  if (!response.ok) {
    if (response.status === 401) localSession.clear();
    let code = 'request_failed';
    try {
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && 'error' in value &&
          typeof value.error === 'string' && knownErrors.has(value.error)) code = value.error;
    } catch { /* Raw response text never enters diagnostics. */ }
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return undefined;
  try { return await response.json(); }
  catch { throw new ApiError(502, 'invalid_response'); }
}

function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== 'object' || !('id' in value) || !('label' in value)) return false;
  return typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.id) &&
    typeof value.label === 'string' && value.label.length > 0 && [...value.label].length <= 40;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object' || !('account_id' in value) || !('observation' in value) ||
      !('imported_at' in value) || typeof value.account_id !== 'string' || typeof value.imported_at !== 'string') return false;
  const observation = value.observation;
  if (!observation || typeof observation !== 'object') return false;
  const data = observation as Record<string, unknown>;
  return typeof data.page_read_at === 'string' && data.server_observed_at === null &&
    data.source === 'user_initiated_browser_selection' && data.freshness === 'unknown' &&
    typeof data.remaining_percent === 'number' && Number.isFinite(data.remaining_percent) && data.remaining_percent >= 0 && data.remaining_percent <= 100 &&
    (data.relative_reset_seconds === null || (typeof data.relative_reset_seconds === 'number' && Number.isSafeInteger(data.relative_reset_seconds) && data.relative_reset_seconds >= 0 && data.relative_reset_seconds <= 366 * 86400)) &&
    (data.credits_balance === null || (typeof data.credits_balance === 'string' && /^\d+(?:\.\d+)?$/.test(data.credits_balance) && data.credits_balance.length <= 128));
}

export const api = {
  async session(bootstrap: string): Promise<void> {
    const result = await request('/session', { method: 'POST', body: JSON.stringify({ bootstrap }) });
    if (!result || typeof result !== 'object' || !('request_token' in result) || !validToken(result.request_token)) {
      throw new ApiError(502, 'invalid_response');
    }
    localSession.set(result.request_token);
  },
  async lock(): Promise<void> {
    try { await request('/session', { method: 'DELETE' }); }
    finally { localSession.clear(); }
  },
  async accounts(): Promise<Account[]> {
    const result = await request('/accounts');
    if (!result || typeof result !== 'object' || !('accounts' in result) || !Array.isArray(result.accounts) || !result.accounts.every(isAccount)) {
      throw new ApiError(502, 'invalid_response');
    }
    return result.accounts;
  },
  async snapshots(): Promise<Snapshot[]> {
    const result = await request('/snapshots');
    if (!result || typeof result !== 'object' || !('snapshots' in result) || !Array.isArray(result.snapshots) || !result.snapshots.every(isSnapshot)) {
      throw new ApiError(502, 'invalid_response');
    }
    return result.snapshots;
  },
  async createAccount(label: string): Promise<Account> {
    const result = await request('/accounts', { method: 'POST', body: JSON.stringify({ label }) });
    if (!isAccount(result)) throw new ApiError(502, 'invalid_response');
    return result;
  },
  async deleteAccount(id: string): Promise<void> {
    await request(`/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async importSnapshot(id: string, report: unknown): Promise<Snapshot> {
    const result = await request(`/accounts/${encodeURIComponent(id)}/import`, { method: 'POST', body: JSON.stringify(report) });
    if (!isSnapshot(result)) throw new ApiError(502, 'invalid_response');
    return result;
  },
};

export function consumeBootstrap(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): string | null {
  const hash = location.hash;
  if (hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('bootstrap');
  return value && /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
}

export async function authenticateFromFragment(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): Promise<void> {
  const bootstrap = consumeBootstrap(location, history);
  if (bootstrap) await api.session(bootstrap);
}

export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '操作未完成，请稍后重试。';
  if (error.status === 401) return '本地会话已结束，请从本机程序重新打开看板。';
  if (error.status === 0) return '无法连接本地看板，请确认本机程序仍在运行。';
  switch (error.code) {
    case 'older_snapshot': return '这份摘要比现有记录更早，已保留较新的记录。';
    case 'snapshot_conflict': return '相同读取时间出现了不同数据，请重新读取官方页面。';
    case 'future_observation': case 'invalid_read_time': return '摘要读取时间不明确或超前，请检查设备时间后重新读取。';
    case 'invalid_label': case 'invalid_account_label': return '请使用 1–40 个字符作为本地账户名称。';
    case 'account_not_found': return '这个本地账户已不存在，请刷新后重新选择。';
    case 'body_too_large': case 'request_too_large': return '摘要过大，请使用扩展生成的额度摘要，最多 32 KiB。';
    case 'not_quota_summary': return '这是程序的许可或源码清单。请导入读取扩展下载的额度摘要 JSON，或使用“粘贴摘要”。';
    case 'invalid_report': case 'invalid_browser_report': case 'invalid_json': return '摘要格式不受支持，请使用网页读取工具重新导出。';
    default: return '操作未完成，请稍后重试。';
  }
}
