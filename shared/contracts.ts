export type Unit = 'percent' | 'credits' | 'CNY' | 'USD' | 'tokens' | 'requests';
export type Source = 'api' | 'manual' | 'extension';
export type ErrorCode = 'unauthorized' | 'rate_limited' | 'upstream_error' | 'invalid_response' | 'timeout' | 'wrong_key_type';
export interface QuotaItem {
 id: string; label: string; amount: number | string | null; unit: Unit;
 resetAt: string | null; limit?: number | string | null; used?: number | string | null;
}
export interface Snapshot {accountLabel?:string;items: QuotaItem[]; source: Source; observedAt: string; fetchedAt: string; staleAfter: number; facts: Facts}
export interface Facts {accountLabel?:string;available?: boolean | null; freeTier?: boolean | null; keyUnlimited?: boolean; limitReset?: 'daily' | 'weekly' | 'monthly' | null}
export interface CredentialStatus {configured: boolean; lastCheckAt: number | null; lastCheckStatus: string; lastErrorCode: ErrorCode | null}
export interface Provider {
 id: string; type: string; label: string; accountLabel?:string; usageUrl?:string; source: Source; region: string; nextAllowedFetch: number;
 credentialSlots?: string[]; credential: CredentialStatus; snapshot: Snapshot | null;
}
export type CardState = 'healthy' | 'warning' | 'reset_due' | 'stale' | 'error_with_cache' | 'error' | 'unconfigured';
export const staleDefaults = {api: 3600, extension: 900, manual: 86400};
export function isStale(snapshot: Snapshot | null, now = Date.now()): boolean {
 return !snapshot || now - Date.parse(snapshot.observedAt) > snapshot.staleAfter * 1000;
}
export function cardState(p: Provider, now = Date.now()): CardState {
 if (p.credential.lastErrorCode) return p.snapshot ? 'error_with_cache' : 'error';
 if (!p.snapshot || (p.source==='api' && !p.credential.configured) || !p.snapshot.items.some(i=>i.amount!==null)) return 'unconfigured';
 if (p.snapshot.items.some(i => i.resetAt !== null && Date.parse(i.resetAt) <= now)) return 'reset_due';
 if (isStale(p.snapshot, now)) return 'stale';
 const main=p.snapshot.items[0];
 if (p.snapshot.facts.available === false || p.snapshot.items.some(i => i.unit==='percent' && i.amount!==null && Number(i.amount)<20) ||
   (main && main.unit!=='percent' && main.amount!==null && Number(main.amount)<=0)) return 'warning';
 return 'healthy';
}
export class InputError extends Error {constructor(public code = 'invalid_input', public status = 400) {super(code)}}
export function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError();
 return value as Record<string, unknown>;
}
export function only(o: Record<string, unknown>, keys: string[]): void {
 if (Object.keys(o).some(k => !keys.includes(k))) throw new InputError();
}
export function numeric(value: unknown): number | string | null {
 if (value === undefined || value === null) return null;
 if (typeof value === 'number' && Number.isFinite(value)) return value;
 if (typeof value === 'string' && value.length <= 60 && /^[+-]?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))) return value;
 throw new InputError();
}
export function parseReset(value: unknown, now = Date.now()): string | null {
 if (value === null || value === undefined || value === '') return null;
 if (typeof value !== 'string' || value.length > 100) throw new InputError('invalid_reset');
 const relative = value.trim().match(/^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?$/i);
 let timestamp: number;
 if (relative && relative[0]) {
  const seconds = Number(relative[1] ?? 0) * 86400 + Number(relative[2] ?? 0) * 3600 + Number(relative[3] ?? 0) * 60;
  if (seconds > 366 * 86400) throw new InputError('invalid_reset');
  timestamp = now + seconds * 1000;
 } else {
  // API absolute timestamps must include a timezone; browser converts datetime-local before posting.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new InputError('invalid_reset');
  timestamp = Date.parse(value);
 }
 if (!Number.isFinite(timestamp)) throw new InputError('invalid_reset');
 return new Date(timestamp).toISOString();
}
export function manualItems(value: unknown, now = Date.now()): QuotaItem[] {
 if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new InputError();
 const ids = new Set<string>();
 return value.map(raw => {
  const o = object(raw); only(o, ['id', 'amount', 'unit', 'resetAt']);
  if (typeof o.id !== 'string' || !/^[a-zA-Z_]{1,40}$/.test(o.id) || ids.has(o.id)) throw new InputError();
  ids.add(o.id);
  if (!['percent', 'credits', 'CNY', 'USD', 'tokens', 'requests'].includes(String(o.unit))) throw new InputError();
  const amount = numeric(o.amount);
  if (amount !== null && o.unit === 'percent' && (Number(amount) < 0 || Number(amount) > 100)) throw new InputError();
  return {id: o.id, label: o.id, unit: o.unit as Unit, amount, resetAt: parseReset(o.resetAt, now)};
 });
}
export function parseBrowserReport(value: unknown, now = Date.now()): Snapshot {
 const r = object(value);
 only(r, ['schema_version', 'provider', 'source', 'source_page', 'page_read_at', 'server_observed_at', 'freshness', 'account', 'provider_pool_id', 'applies_to_products', 'real_account_verified', 'weekly', 'credits']);
 if (r.schema_version !== 1 || r.provider !== 'openai' || r.source !== 'user_initiated_browser_selection' ||
 r.source_page !== 'https://chatgpt.com/settings/usage?tab=overview' || r.server_observed_at != null || r.freshness !== 'unknown' ||
 r.account != null || r.provider_pool_id != null || r.applies_to_products != null || r.real_account_verified !== false) throw new InputError('invalid_report');
 if (typeof r.page_read_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.page_read_at) ||
 !Number.isFinite(Date.parse(r.page_read_at)) || new Date(r.page_read_at).toISOString() !== r.page_read_at || Date.parse(r.page_read_at) > now + 30000) throw new InputError('invalid_report');
 const w = object(r.weekly); only(w, ['window', 'remaining_percent', 'resets_at', 'reset_relative']);
 if (w.window !== 'weekly' || w.resets_at != null || typeof w.remaining_percent !== 'number' || !Number.isFinite(w.remaining_percent) || w.remaining_percent < 0 || w.remaining_percent > 100) throw new InputError('invalid_report');
 let resetAt: string | null = null;
 if (w.reset_relative != null) {
  const t = object(w.reset_relative); only(t, ['label', 'seconds', 'precision']);
  if (t.precision !== 'estimated_from_display' || typeof t.label !== 'string' || t.label.length > 128 || typeof t.seconds !== 'number' || !Number.isInteger(t.seconds) || t.seconds < 0 || t.seconds > 366 * 86400) throw new InputError('invalid_report');
  resetAt = new Date(Date.parse(r.page_read_at) + t.seconds * 1000).toISOString();
 }
 const items: QuotaItem[] = [{id: 'weekly_percent', label: 'weekly_percent', amount: w.remaining_percent, unit: 'percent', resetAt}];
 if (r.credits != null) {
  const c = object(r.credits); only(c, ['meter_kind', 'balance', 'unit']);
  if (c.meter_kind !== 'consumer_credit_balance' || c.unit !== 'credits' || typeof c.balance !== 'string' || numeric(c.balance) === null) throw new InputError('invalid_report');
  items.push({id: 'credits', label: 'credits', amount: c.balance, unit: 'credits', resetAt: null});
 }
 return {items, source: 'extension', observedAt: r.page_read_at, fetchedAt: new Date(now).toISOString(), staleAfter: 900, facts: {}};
}
