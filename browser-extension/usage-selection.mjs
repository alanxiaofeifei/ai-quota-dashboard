// Narrow projection of user-selected English Usage text. No browser or network API.
export const MAX_SELECTION_BYTES = 16 * 1024;
export const CANONICAL_USAGE_URL = 'https://chatgpt.com/settings/usage?tab=overview';

export class UsageSelectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UsageSelectionError';
    this.code = code;
  }
}

function fail(code) { throw new UsageSelectionError(code); }

export function isUsageOverviewUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    const query = [...url.searchParams];
    return url.origin === 'https://chatgpt.com' && !url.username && !url.password &&
      url.pathname === '/settings/usage' && !url.hash &&
      (query.length === 0 || (query.length === 1 && query[0][0] === 'tab' && query[0][1] === 'overview'));
  } catch { return false; }
}

function matches(value, expression) { return [...value.matchAll(expression)]; }

function prefixHasSignOrCurrency(value, index) {
  const prefix = value.slice(0, index);
  return /[-+\u2212$€£¥\d.,]\s*$/.test(prefix) || /\b(?:USD|EUR|GBP|JPY|CNY)\s*$/i.test(prefix);
}

function resetFromSection(section) {
  const labels = matches(section, /\bResets\s+in\b/gi);
  if (labels.length > 1) fail('ambiguous_reset');
  if (labels.length === 0) return { relative: null, withoutDuration: section };
  const label = labels[0];
  const start = label.index + label[0].length;
  const tail = section.slice(start);
  const duration = tail.match(/^\s*((?:\d+\s*[dhm](?=\s|\d|$)\s*)+)/i);
  if (!duration) return { relative: null, withoutDuration: section };
  const afterDuration = tail.slice(duration[0].length);
  if (afterDuration.trim() && !/^\s*\d+(?:\.\d+)?\s*%\s*left\b/i.test(afterDuration)) fail('invalid_reset');
  const parts = matches(duration[1], /(\d+)\s*([dhm])/gi);
  let seconds = 0;
  const seen = new Set();
  const normalized = [];
  for (const part of parts) {
    const number = Number(part[1]);
    const unit = part[2].toLowerCase();
    if (!Number.isSafeInteger(number) || seen.has(unit)) fail('invalid_reset');
    seen.add(unit);
    seconds += number * ({ d: 86400, h: 3600, m: 60 })[unit];
    normalized.push(`${number}${unit}`);
  }
  if (!Number.isSafeInteger(seconds) || seconds > 366 * 86400) fail('invalid_reset');
  return {
    relative: { label: normalized.join(' '), seconds, precision: 'estimated_from_display' },
    // Removing only the matched duration also handles joined text such as 4h37%left.
    withoutDuration: section.slice(0, label.index) + ' ' + section.slice(start + duration[0].length),
  };
}

function weeklyFromText(text) {
  const labels = matches(text, /\bWeekly\s+limit\b/gi);
  if (labels.length === 0) fail('weekly_limit_missing');
  if (labels.length !== 1) fail('ambiguous_weekly_limit');
  const tail = text.slice(labels[0].index + labels[0][0].length);
  const boundary = tail.search(/\b(?:Recent\s+plan\s+usage|Credits|Usage\s+limit\s+resets|Full\s+reset|Credit\s+usage\s+history)\b/i);
  const section = boundary < 0 ? tail : tail.slice(0, boundary);
  const reset = resetFromSection(section);
  const percentages = matches(reset.withoutDuration, /([^\s]+)\s*%\s*left\b/gi);
  if (percentages.length === 0) fail('remaining_percentage_missing');
  if (percentages.length !== 1) fail('ambiguous_remaining_percentage');
  const match = percentages[0];
  if (!/^\d+(?:\.\d+)?$/.test(match[1]) || prefixHasSignOrCurrency(reset.withoutDuration, match.index)) {
    fail('invalid_remaining_percentage');
  }
  const percentage = Number(match[1]);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) fail('invalid_remaining_percentage');
  return {
    window: 'weekly',
    remaining_percent: percentage,
    resets_at: null,
    reset_relative: reset.relative,
  };
}

function creditsFromText(text) {
  const weekly = text.search(/\bWeekly\s+limit\b/i);
  const afterWeekly = text.slice(weekly);
  const header = /\bCredits\b/i.exec(afterWeekly);
  if (!header) return null;
  const start = weekly + header.index;
  const isApiHeading = /\bAPI\s*$/i.test(text.slice(Math.max(0, start - 32), start));
  const tail = text.slice(start);
  const boundary = tail.search(/\b(?:Usage\s+limit\s+resets|Full\s+reset|Credit\s+usage\s+history)\b/i);
  const section = boundary < 0 ? tail : tail.slice(0, boundary);
  const balances = matches(section, /([^\s]+)\s+credits?\s+remaining\b/gi);
  if (balances.length === 0) return null;
  if (balances.length !== 1) fail('ambiguous_credit_balance');
  const match = balances[0];
  if (!/^\d+(?:\.\d+)?$/.test(match[1]) || match[1].length > 128 ||
      isApiHeading || prefixHasSignOrCurrency(section, match.index) || /\bAPI\b/i.test(section.slice(0, match.index))) {
    fail('invalid_credit_balance');
  }
  return { meter_kind: 'consumer_credit_balance', balance: match[1], unit: 'credits' };
}

export function parseUsageSelection(value, { pageUrl, observedAt } = {}) {
  if (!isUsageOverviewUrl(pageUrl)) fail('wrong_page');
  if (typeof value !== 'string') fail('selection_missing');
  if (value.length > MAX_SELECTION_BYTES || new TextEncoder().encode(value).length > MAX_SELECTION_BYTES) fail('selection_too_large');
  if (!value.trim()) fail('selection_missing');
  if (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt) ||
      !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) fail('invalid_read_time');
  const text = value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
  const weekly = weeklyFromText(text);
  const credits = creditsFromText(text);
  return {
    schema_version: 1,
    provider: 'openai',
    source: 'user_initiated_browser_selection',
    source_page: CANONICAL_USAGE_URL,
    page_read_at: observedAt,
    server_observed_at: null,
    freshness: 'unknown',
    account: null,
    provider_pool_id: null,
    applies_to_products: null,
    real_account_verified: false,
    weekly,
    credits,
  };
}
