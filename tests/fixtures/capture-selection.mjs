// This entire function is serialized by chrome.scripting. It must not depend on imports.
export function captureUsageSelection() {
  const allowed = value => {
    try {
      const url = new URL(value);
      const query = [...url.searchParams];
      return url.origin === 'https://chatgpt.com' && !url.username && !url.password &&
        url.pathname === '/settings/usage' && !url.hash &&
        (query.length === 0 || (query.length === 1 && query[0][0] === 'tab' && query[0][1] === 'overview'));
    } catch { return false; }
  };
  try {
    const before = location.href;
    if (!allowed(before)) return { ok: false, error: 'wrong_page' };
    const text = window.getSelection()?.toString() ?? '';
    if (location.href !== before || !allowed(location.href)) return { ok: false, error: 'page_changed' };
    if (!text.trim()) return { ok: false, error: 'selection_missing' };
    if (text.length > 16384 || new TextEncoder().encode(text).length > 16384) return { ok: false, error: 'selection_too_large' };
    return { ok: true, text, pageUrl: 'https://chatgpt.com/settings/usage?tab=overview', observedAt: new Date().toISOString() };
  } catch { return { ok: false, error: 'selection_read_failed' }; }
}
