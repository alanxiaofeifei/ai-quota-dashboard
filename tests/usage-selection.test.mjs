import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { isUsageOverviewUrl, parseUsageSelection, UsageSelectionError, MAX_SELECTION_BYTES } from '../browser-extension/usage-selection.mjs';
import { captureUsageSelection } from '../browser-extension/capture-selection.mjs';

const pageUrl = 'https://chatgpt.com/settings/usage?tab=overview';
const observedAt = '2026-11-01T12:34:56.000Z';
const fixture = `Usage
Plan limits
Weekly limit
Resets in 3d 4h37% left
Recent plan usage
How your activity draws down your allowance
Credits
Buy credits or turn on automatic reload
12.75 credits remaining
Current balance
Automatic reload
Usage limit resets
Full reset
Expires Jan 8, 9:17 AM GMT+8
Credit usage history`;
const parse = text => parseUsageSelection(text, { pageUrl, observedAt });

function rejects(text, code) {
  assert.throws(() => parse(text), error => error instanceof UsageSelectionError && error.code === code);
}

test('only the known Usage overview route is allowed', () => {
  for (const url of ['https://chatgpt.com/settings/usage', pageUrl]) assert.equal(isUsageOverviewUrl(url), true);
  for (const url of [
    'https://chatgpt.com/', 'https://chatgpt.com/c/chat-id',
    'https://chatgpt.com/codex/settings/usage',
    'http://chatgpt.com/settings/usage', 'https://example.invalid/settings/usage',
    'https://chatgpt.com/settings/usage?tab=history',
    'https://chatgpt.com/settings/usage?tab=overview&tab=overview',
    'https://chatgpt.com/settings/usage?tab=overview&token=synthetic-secret',
    'https://chatgpt.com/settings/usage#chat',
    'https://synthetic:secret@chatgpt.com/settings/usage',
    'https://chatgpt.com/settings/usage/', 'not a url',
  ]) assert.equal(isUsageOverviewUrl(url), false, url);
});

test('joined duration and percentage remain distinct, with no invented absolute reset', () => {
  const report = parse(fixture);
  assert.equal(report.weekly.remaining_percent, 37);
  assert.deepEqual(report.weekly.reset_relative, { label: '3d 4h', seconds: 273600, precision: 'estimated_from_display' });
  assert.equal(report.weekly.resets_at, null);
  assert.equal(report.page_read_at, observedAt);
  assert.equal(report.server_observed_at, null);
  assert.equal(report.freshness, 'unknown');
  assert.equal(report.account, null);
  assert.equal(report.provider_pool_id, null);
  assert.equal(report.applies_to_products, null);
  assert.equal(report.real_account_verified, false);
  assert.equal(report.source_page, pageUrl);
  assert.equal('primary' in report, false);
  assert.equal('five_hour' in report, false);
});

test('credits are separate decimal consumer units, without price or API interpretation', () => {
  const report = parse(fixture);
  assert.deepEqual(report.credits, { meter_kind: 'consumer_credit_balance', balance: '12.75', unit: 'credits' });
  assert.equal('currency' in report.credits, false);
  assert.equal('api_balance' in report, false);
});

test('genuine zero and full remaining ratios are measurements, not error defaults', () => {
  assert.equal(parse('Weekly limit\n0% left').weekly.remaining_percent, 0);
  assert.equal(parse('Weekly limit\n100% left').weekly.remaining_percent, 100);
  rejects('Weekly limit\nUnavailable', 'remaining_percentage_missing');
  rejects('Weekly limit\n23% used', 'remaining_percentage_missing');
});

test('zero credits cannot change the weekly measurement', () => {
  const report = parse('Weekly limit\n61% left\nCredits\n0 credits remaining');
  assert.equal(report.weekly.remaining_percent, 61);
  assert.equal(report.credits.balance, '0');
});

test('missing credit balance and reset remain unknown', () => {
  const report = parse('Weekly limit\n29.5 % left\nCredits\nBuy credits');
  assert.equal(report.weekly.reset_relative, null);
  assert.equal(report.weekly.resets_at, null);
  assert.equal(report.credits, null);
});

test('other sections and Full reset expiry cannot supply weekly reset or percentages', () => {
  const report = parse('Weekly limit\n72% left\nRecent plan usage\n11% left\nCredits\n8 credits remaining\nUsage limit resets\nFull reset\nResets in 9d\nExpires Jan 8, 9:17 AM GMT+8\nCredit usage history\n88 credits remaining');
  assert.equal(report.weekly.remaining_percent, 72);
  assert.equal(report.weekly.reset_relative, null);
  assert.equal(report.weekly.resets_at, null);
  assert.equal(report.credits.balance, '8');
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('Expires'), false);
  assert.equal(serialized.includes('GMT'), false);
});

test('ambiguous measurements, duplicate headings and resets fail safely', () => {
  rejects('Weekly limit\n31% left\n32% left', 'ambiguous_remaining_percentage');
  rejects('Weekly limit\n31% left\nWeekly limit\n32% left', 'ambiguous_weekly_limit');
  rejects('Weekly limit\nResets in 3d\nResets in 4h\n31% left', 'ambiguous_reset');
  rejects('Weekly limit\n31% left\nCredits\n3 credits remaining\n4 credits remaining', 'ambiguous_credit_balance');
});

test('malformed numeric values are rejected instead of matching a suffix', () => {
  for (const number of ['-3', '- 3', '+3', '−3', '$3', '$ 3', 'USD 3', '1,003', '1 003', '3e1', '.5', '101', 'NaN']) {
    rejects(`Weekly limit\n${number}% left`, 'invalid_remaining_percentage');
  }
  for (const balance of ['-5', '- 5', '$1,000', 'USD 5', '1,000', '1 000', '+5', '1e2', '−5']) {
    rejects(`Weekly limit\n31% left\nCredits\n${balance} credits remaining`, 'invalid_credit_balance');
  }
  rejects('Weekly limit\n31% left\nAPI Credits\n5 credits remaining', 'invalid_credit_balance');
});

test('malformed relative resets are not promoted to a verified time', () => {
  rejects('Weekly limit\nResets in 3d 4d\n31% left', 'invalid_reset');
  rejects('Weekly limit\nResets in 999999999999999999999d\n31% left', 'invalid_reset');
  rejects('Weekly limit\nResets in 3d 4.5h\n31% left', 'invalid_reset');
  assert.equal(parse('Weekly limit\nResets in 3d-4h\n31% left').weekly.reset_relative, null);
  const report = parse('Weekly limit\nResets soon\n31% left');
  assert.equal(report.weekly.reset_relative, null);
  assert.equal(report.weekly.resets_at, null);
});

test('selection bounds use UTF-8 bytes, not only string length', () => {
  rejects('', 'selection_missing');
  rejects(' '.repeat(10), 'selection_missing');
  rejects('x'.repeat(MAX_SELECTION_BYTES + 1), 'selection_too_large');
  rejects('界'.repeat(6000), 'selection_too_large');
});

test('unknown scope, labels and synthetic secrets never enter the exported report', () => {
  const report = parse(`email: synthetic@example.invalid
accessToken: SYNTHETIC_SECRET_DO_NOT_EXPORT
privateChat: SYNTHETIC_CHAT_DO_NOT_EXPORT
Shared across Synthetic Agent A and Synthetic Agent B
Chat conversations are not included.
${fixture}`);
  const serialized = JSON.stringify(report);
  for (const forbidden of ['synthetic@example.invalid', 'SYNTHETIC_SECRET', 'SYNTHETIC_CHAT', 'Synthetic Agent', 'Expires', 'Chat conversations']) assert.equal(serialized.includes(forbidden), false);
  assert.equal(report.applies_to_products, null);
});

test('invalid page or missing read timestamp cannot produce a report', () => {
  assert.throws(() => parseUsageSelection(fixture, { pageUrl: 'https://chatgpt.com/', observedAt }), { code: 'wrong_page' });
  assert.throws(() => parseUsageSelection(fixture, { pageUrl }), { code: 'invalid_read_time' });
});

function capture(context) {
  return vm.runInNewContext(`(${captureUsageSelection.toString()})()`, { TextEncoder, Date, URL, ...context });
}

test('injected capture is self-contained and never reads a rejected page selection', () => {
  let reads = 0;
  const result = capture({ location: { href: 'https://chatgpt.com/c/chat-id' }, window: { getSelection() { reads++; return 'SYNTHETIC_CHAT'; } } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'wrong_page');
  assert.equal(reads, 0);
});

test('capture rechecks the URL after reading and discards navigation races', () => {
  let reads = 0;
  const location = { get href() { return reads > 0 ? 'https://chatgpt.com/' : pageUrl; } };
  const result = capture({ location, window: { getSelection() { reads++; return fixture; } } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'page_changed');
  assert.equal('text' in result, false);
});

test('capture exports only user selection on an allowed page and enforces byte bounds', () => {
  const context = text => ({ location: { href: pageUrl }, window: { getSelection() { return { toString() { return text; } }; } } });
  const result = capture(context(fixture));
  assert.equal(result.ok, true);
  assert.equal(result.text, fixture);
  assert.equal(result.pageUrl, pageUrl);
  assert.equal(capture(context('界'.repeat(6000))).error, 'selection_too_large');
  assert.equal(capture(context('')).error, 'selection_missing');
});

test('extension permission and network boundaries remain minimal', async () => {
  const manifest = JSON.parse(await readFile(new URL('../browser-extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting']);
  for (const key of ['host_permissions', 'content_scripts', 'background', 'web_accessible_resources']) assert.equal(key in manifest, false);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  const popup = await readFile(new URL('../browser-extension/popup.js', import.meta.url), 'utf8');
  assert.equal(popup.includes('console.'), false);
  assert.equal(popup.includes('fetch('), false);
  assert.equal(popup.includes('localStorage'), false);
});
