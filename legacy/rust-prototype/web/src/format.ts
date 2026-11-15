export const STALE_AFTER_MS = 15 * 60 * 1000;

export function formatPercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    : '暂不可用';
}

export function formatCredits(value: unknown): string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && value.length <= 128
    ? value
    : '未知';
}

export function timestamp(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function captureState(readAt: string, now: number): 'recent' | 'stale' | 'unknown' {
  const time = timestamp(readAt);
  if (time === null || !Number.isFinite(now) || time > now + 5 * 60 * 1000) return 'unknown';
  return now - time >= STALE_AFTER_MS ? 'stale' : 'recent';
}

export function formatTimestamp(value: string, timeZone: string): string {
  const time = timestamp(value);
  if (time === null) return '未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(time);
  } catch { return '未知'; }
}

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'; }
  catch { return 'Asia/Taipei'; }
}

export function estimatedReset(readAt: string, seconds: number | null, now: number): {
  state: 'unknown' | 'expected' | 'due'; at: number | null; text: string;
} {
  const read = timestamp(readAt);
  if (read === null || seconds === null || !Number.isSafeInteger(seconds) || seconds < 0 ||
      seconds > 366 * 86400 || !Number.isFinite(now)) {
    return { state: 'unknown', at: null, text: '页面未提供重置提示' };
  }
  if (read > now + 5 * 60 * 1000) return {
    state: 'unknown', at: null, text: '设备时间与摘要不一致，无法估计重置',
  };
  const at = read + seconds * 1000;
  if (at <= now) return {
    state: 'due', at,
    text: '预计已到重置时间，尚未确认恢复，请重新读取官方页面',
  };
  const minutes = Math.ceil((at - now) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [days ? `${days} 天` : '', hours ? `${hours} 小时` : '', (!days && rest) ? `${rest} 分钟` : ''].filter(Boolean);
  return { state: 'expected', at, text: `预计约 ${parts.join(' ') || '1 分钟'}后重置` };
}
