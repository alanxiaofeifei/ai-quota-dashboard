import { type Provider, type Snapshot, type ErrorCode } from '../shared/contracts';
interface Row {
 id: string; provider_type: string; label: string; source_mode: Provider['source']; config_json: string; next_allowed_fetch_ms: number;
 provider_id: string | null; last_check_at: number | null; last_check_status: string | null; last_error_code: ErrorCode | null;
 source: Snapshot['source'] | null; items_json: string | null; facts_json: string | null; fetched_at: string | null; observed_at: string | null; stale_after: number | null;
}
export async function overview(db: D1Database): Promise<Provider[]> {
 const result=await db.prepare(`SELECT p.*,c.provider_id,c.last_check_at,c.last_check_status,c.last_error_code,
 s.source,s.items_json,s.facts_json,s.fetched_at,s.observed_at,s.stale_after
 FROM providers p LEFT JOIN credentials c ON c.provider_id=p.id LEFT JOIN snapshots s ON s.provider_id=p.id
 WHERE p.enabled=1 ORDER BY p.sort_order,p.created_at,p.id`).all<Row>();
 return result.results.map(r=>({
  id:r.id,type:r.provider_type,label:r.label,source:r.source??r.source_mode,region:JSON.parse(r.config_json).region??'cn',nextAllowedFetch:r.next_allowed_fetch_ms,
  credential:{configured:r.provider_id!==null,lastCheckAt:r.last_check_at,lastCheckStatus:r.last_check_status??'unverified',lastErrorCode:r.last_error_code},
  snapshot:r.items_json===null?null:{items:JSON.parse(r.items_json),facts:JSON.parse(r.facts_json??'{}'),source:r.source!,observedAt:r.observed_at!,fetchedAt:r.fetched_at!,staleAfter:r.stale_after!}
 }));
}
export function snapshotStatement(db: D1Database,id: string,s: Snapshot,now: number) {
 return db.prepare(`INSERT INTO snapshots(provider_id,source,items_json,facts_json,fetched_at,observed_at,stale_after,updated_at)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET source=excluded.source,items_json=excluded.items_json,
 facts_json=excluded.facts_json,fetched_at=excluded.fetched_at,observed_at=excluded.observed_at,stale_after=excluded.stale_after,updated_at=excluded.updated_at
 WHERE excluded.observed_at>=snapshots.observed_at`).bind(id,s.source,JSON.stringify(s.items),JSON.stringify(s.facts),s.fetchedAt,s.observedAt,s.staleAfter,now);
}
export async function claimRefresh(db: D1Database,id: string,now: number): Promise<boolean> {
 const r=await db.prepare('UPDATE providers SET next_allowed_fetch_ms=? WHERE id=? AND next_allowed_fetch_ms<=?').bind(now+60000,id,now).run();
 return r.meta.changes===1;
}
export async function deferRefresh(db: D1Database,id: string,until: number) {
 await db.prepare('UPDATE providers SET next_allowed_fetch_ms=MAX(next_allowed_fetch_ms,?) WHERE id=?').bind(until,id).run();
}
export async function checkStatus(db: D1Database,id: string,now: number,error: ErrorCode | null) {
 await db.prepare('UPDATE credentials SET last_check_at=?,last_check_status=?,last_error_code=?,updated_at=? WHERE provider_id=?').bind(now,error??'ok',error,now,id).run();
}
export async function concurrent<T>(items: T[], limit: number, fn: (item: T)=>Promise<void>): Promise<void> {
 let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const item=items[next++];await fn(item)}}));
}
