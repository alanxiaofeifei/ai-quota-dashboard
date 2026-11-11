import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { isUsageOverviewUrl, parseUsageSelection, UsageSelectionError } from '../browser-extension/usage-selection.mjs';
import { captureUsageSelection } from '../browser-extension/capture-selection.mjs';

// Execute the actual popup event handlers with controlled DOM/browser adapters.
// These tests never open a browser, read a clipboard or contact an account.
const popup = (await readFile(new URL('../browser-extension/popup.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '');
const pageUrl = 'https://chatgpt.com/settings/usage?tab=overview';
const observedAt = '2026-11-01T12:34:56.000Z';
const forbidden = ['SYNTHETIC_SECRET_DO_NOT_COPY', 'SYNTHETIC_CHAT_DO_NOT_COPY', 'synthetic@example.invalid'];
const selection = `${forbidden.join('\n')}
Weekly limit
Resets in 3d 4h
37% left
Credits
12.75 credits remaining`;

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function harness() {
  const elements = new Map();
  for (const id of ['read', 'result', 'status', 'copy', 'download', 'copy-status', 'manual-copy', 'summary-text', 'remaining', 'reset', 'credits', 'read-time']) {
    elements.set(id, {
      disabled: false, hidden: false, value: '', textContent: '', handlers: {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      focus() { this.focused = true; },
      select() { this.selected = true; },
    });
  }
  const state = { selection, writes: [], captures: [], clipboardReads: 0, storageAccesses: 0, networkCalls: 0, downloads: 0, queries: 0 };
  const navigator = {
    clipboard: {
      async writeText(text) { state.writes.push(text); },
      async readText() { state.clipboardReads++; throw new Error('clipboard_read_forbidden'); },
    },
  };
  const chrome = {
    tabs: {
      async query() { state.queries++; return [{ id: 1, url: pageUrl }]; },
      async get() { return { url: pageUrl }; },
    },
    scripting: {
      async executeScript() {
        const result = { frameId: 0, result: { ok: true, text: state.selection, pageUrl, observedAt } };
        state.captures.push(result);
        return [result];
      },
    },
  };
  const context = {
    document: {
      getElementById: id => elements.get(id),
      createElement: () => ({ click() { state.downloads++; } }),
    },
    navigator, chrome, isUsageOverviewUrl, parseUsageSelection, UsageSelectionError, captureUsageSelection,
    Date, Blob, setTimeout,
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    fetch() { state.networkCalls++; throw new Error('network_forbidden'); },
  };
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(context, key, { get() { state.storageAccesses++; throw new Error('storage_forbidden'); } });
  }
  vm.runInNewContext(popup, context);
  return { state, elements, navigator, chrome, click: id => elements.get(id).handlers.click() };
}

function assertSafe(text) {
  for (const marker of forbidden) assert.equal(text.includes(marker), false);
}

test('only explicit copy writes the projected report; raw selection is discarded without storage or network', async () => {
  const app = harness();
  await app.click('copy');
  assert.equal(app.state.writes.length, 0);
  await app.click('read');
  assert.equal(app.state.writes.length, 0);
  assert.equal(app.elements.get('copy').disabled, false);
  assert.equal('text' in app.state.captures[0].result, false);

  await app.click('copy');
  assert.equal(app.state.writes.length, 1);
  const copied = app.state.writes[0];
  const report = JSON.parse(copied);
  assert.equal(report.weekly.remaining_percent, 37);
  assert.equal(report.credits.balance, '12.75');
  assert.equal(report.page_read_at, observedAt);
  assert.equal(report.server_observed_at, null);
  assert.equal(report.real_account_verified, false);
  assertSafe(copied);
  assertSafe([...app.elements.values()].map(element => `${element.textContent}\n${element.value}`).join('\n'));
  assert.equal(app.state.clipboardReads, 0);
  assert.equal(app.state.storageAccesses, 0);
  assert.equal(app.state.networkCalls, 0);
  assert.equal(app.state.downloads, 0);
});

test('unavailable or rejected clipboard writes expose only a manually selectable safe summary', async t => {
  for (const mode of ['missing', 'rejected']) {
    await t.test(mode, async () => {
      const app = harness();
      await app.click('read');
      if (mode === 'missing') app.navigator.clipboard = undefined;
      else app.navigator.clipboard.writeText = async () => { throw new Error('SYNTHETIC_SECRET_DO_NOT_COPY'); };
      await app.click('copy');
      assert.equal(app.elements.get('manual-copy').hidden, false);
      const text = app.elements.get('summary-text');
      assert.equal(text.focused, true);
      assert.equal(text.selected, true);
      assert.equal(JSON.parse(text.value).credits.balance, '12.75');
      assertSafe(text.value);
      assertSafe(app.elements.get('copy-status').textContent);
      assert.equal(app.state.clipboardReads, 0);
      assert.equal(app.state.downloads, 0);
    });
  }
});

test('a failed new read clears fallback text and cannot copy or download an older successful report', async () => {
  const app = harness();
  app.navigator.clipboard = undefined;
  await app.click('read');
  await app.click('copy');
  assert.notEqual(app.elements.get('summary-text').value, '');

  app.state.selection = 'Weekly limit\nUnavailable';
  await app.click('read');
  assert.equal(app.elements.get('manual-copy').hidden, true);
  assert.equal(app.elements.get('summary-text').value, '');
  assert.equal(app.elements.get('copy').disabled, true);
  assert.equal(app.elements.get('download').disabled, true);
  assert.equal(app.elements.get('result').hidden, true);
  await app.click('copy');
  await app.click('download');
  assert.equal(app.state.writes.length, 0);
  assert.equal(app.state.downloads, 0);
  assert.equal(app.elements.get('summary-text').value, '');
});

test('out-of-order earlier reads cannot replace a newer result and still discard captured raw text', async () => {
  const app = harness();
  const firstQuery = deferred();
  let queryCount = 0;
  let oldCapture;
  app.chrome.tabs.query = () => ++queryCount === 1 ? firstQuery.promise : Promise.resolve([{ id: 22, url: pageUrl }]);
  app.chrome.scripting.executeScript = async ({ target }) => {
    const result = { frameId: 0, result: { ok: true, text: `Weekly limit\n${target.tabId === 11 ? 31 : 62}% left`, pageUrl, observedAt } };
    if (target.tabId === 11) oldCapture = result;
    return [result];
  };
  const oldRead = app.click('read');
  await app.click('read');
  firstQuery.resolve([{ id: 11, url: pageUrl }]);
  await oldRead;
  assert.equal(app.elements.get('remaining').textContent, '62%');
  assert.equal('text' in oldCapture.result, false);
  await app.click('copy');
  assert.equal(JSON.parse(app.state.writes[0]).weekly.remaining_percent, 62);
});

test('a late earlier failure cannot hide the current successful result or replace its status', async () => {
  const app = harness();
  const firstQuery = deferred();
  let queryCount = 0;
  app.chrome.tabs.query = () => ++queryCount === 1 ? firstQuery.promise : Promise.resolve([{ id: 22, url: pageUrl }]);
  const oldRead = app.click('read');
  await app.click('read');
  const successStatus = app.elements.get('status').textContent;
  firstQuery.reject(new Error('SYNTHETIC_SECRET_DO_NOT_COPY'));
  await oldRead;
  assert.equal(app.elements.get('status').textContent, successStatus);
  assert.equal(app.elements.get('result').hidden, false);
  assert.equal(app.elements.get('copy').disabled, false);
  await app.click('copy');
  assert.equal(JSON.parse(app.state.writes[0]).weekly.remaining_percent, 37);
});

test('an uncancellable pending copy blocks new reads and duplicate copy until the write completes', async () => {
  const app = harness();
  await app.click('read');
  const write = deferred();
  app.navigator.clipboard.writeText = text => { app.state.writes.push(text); return write.promise; };
  const copying = app.click('copy');
  assert.equal(app.elements.get('read').disabled, true);
  assert.equal(app.elements.get('copy').disabled, true);
  const queries = app.state.queries;
  await app.click('read');
  await app.click('copy');
  assert.equal(app.state.queries, queries);
  assert.equal(app.state.writes.length, 1);
  write.resolve();
  await copying;
  assert.equal(app.elements.get('read').disabled, false);
  assert.equal(app.elements.get('copy').disabled, false);

  app.state.selection = 'Weekly limit\n62% left';
  await app.click('read');
  assert.equal(app.state.queries, queries + 1);
  assert.equal(app.elements.get('remaining').textContent, '62%');
});
