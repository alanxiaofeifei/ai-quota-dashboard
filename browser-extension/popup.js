import { isUsageOverviewUrl, parseUsageSelection, UsageSelectionError } from './usage-selection.mjs';
import { captureUsageSelection } from './capture-selection.mjs';

const readButton = document.getElementById('read');
const resultPanel = document.getElementById('result');
const status = document.getElementById('status');
const copyButton = document.getElementById('copy');
const downloadButton = document.getElementById('download');
const copyStatus = document.getElementById('copy-status');
const manualCopy = document.getElementById('manual-copy');
const summaryText = document.getElementById('summary-text');
let report = null;
let readRevision = 0;
let copying = false;
const messages = {
  wrong_page: '请在官方 Usage 概览页操作；首页和聊天页面不会被读取。',
  page_changed: '页面已切换，本次结果已丢弃。请回到 Usage 概览页重新选择。',
  selection_missing: '尚未选中文字。请选中 Weekly limit 和 Credits 额度区域后再读取。',
  selection_too_large: '选区超过 16 KiB，请只选择额度区域。',
  weekly_limit_missing: '选区没有 Weekly limit。请只选择英文额度区域。',
  remaining_percentage_missing: '没有找到明确的剩余百分比；本次不会生成零值。',
  invalid_remaining_percentage: '剩余比例格式不明确，暂不可用。',
  ambiguous_remaining_percentage: '选区存在多个剩余比例，请缩小到一个周额度区域。',
  ambiguous_weekly_limit: '选区存在多个周额度，请缩小范围。',
  invalid_credit_balance: 'credits 格式不明确，本次数据暂不可用。',
  ambiguous_credit_balance: '选区存在多个 credits 余额，请缩小范围。',
  invalid_reset: '页面重置提示格式不明确，本次数据暂不可用。',
  ambiguous_reset: '选区存在多个重置提示，请缩小范围。',
};

readButton.addEventListener('click', async () => {
  // A clipboard write cannot be cancelled once handed to the browser. Keep
  // reads disabled until that explicit copy operation has finished.
  if (copying) return;
  const revision = ++readRevision;
  report = null;
  resultPanel.hidden = true;
  readButton.disabled = true;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  manualCopy.hidden = true;
  summaryText.value = '';
  copyStatus.textContent = '';
  status.textContent = '正在读取你选择的额度文字…';
  let results;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !isUsageOverviewUrl(tab.url)) throw new UsageSelectionError('wrong_page');
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureUsageSelection });
    if (results.length !== 1 || results[0].frameId !== 0) throw new UsageSelectionError('selection_read_failed');
    const currentTab = await chrome.tabs.get(tab.id);
    if (revision !== readRevision) return;
    if (!isUsageOverviewUrl(currentTab.url) || currentTab.url !== tab.url) throw new UsageSelectionError('page_changed');
    const captured = results[0].result;
    if (!captured?.ok) throw new UsageSelectionError(captured?.error ?? 'selection_read_failed');
    const nextReport = parseUsageSelection(captured.text, { pageUrl: captured.pageUrl, observedAt: captured.observedAt });
    if (revision !== readRevision) return;
    report = nextReport;
    document.getElementById('remaining').textContent = `${report.weekly.remaining_percent}%`;
    document.getElementById('reset').textContent = report.weekly.reset_relative ? `约 ${report.weekly.reset_relative.label} 后（未确认）` : '未知';
    document.getElementById('credits').textContent = report.credits ? `${report.credits.balance} credits` : '未知（未选中或未提供）';
    document.getElementById('read-time').textContent = new Date(report.page_read_at).toLocaleString();
    resultPanel.hidden = false;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    copyStatus.textContent = '核对无误后复制，回到本地看板选择账户，再点击“粘贴摘要”。';
    status.textContent = '本地解析完成。请与页面核对；这不是账户或自动采集验证通过。';
  } catch (error) {
    if (revision !== readRevision) return;
    status.textContent = error instanceof UsageSelectionError && messages[error.code] ? messages[error.code] : '读取未完成。未生成额度数据，请返回官方页面重新选择。';
  } finally {
    for (const item of results ?? []) if (item.result && typeof item.result === 'object') delete item.result.text;
    results = undefined;
    if (revision === readRevision) readButton.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  if (!report || copying || readButton.disabled) return;
  const currentReport = report;
  const revision = readRevision;
  // This is the same narrow report used for downloading, never the original
  // selected page text. No clipboard reads or extra permissions are requested.
  const text = JSON.stringify(currentReport, null, 2) + '\n';
  copying = true;
  copyButton.disabled = true;
  readButton.disabled = true;
  manualCopy.hidden = true;
  summaryText.value = '';
  copyStatus.textContent = '正在复制本次额度摘要…';
  try {
    if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard_unavailable');
    await navigator.clipboard.writeText(text);
    if (revision !== readRevision || report !== currentReport) return;
    copyStatus.textContent = '摘要已复制。回到本地看板，选择账户并点击“粘贴摘要”，按 Ctrl+V 后确认导入。';
  } catch {
    if (revision !== readRevision || report !== currentReport) return;
    summaryText.value = text;
    manualCopy.hidden = false;
    copyStatus.textContent = '直接复制未完成，请在下框手动复制，或下载摘要 JSON。';
    summaryText.focus();
    summaryText.select();
  } finally {
    copying = false;
    if (revision === readRevision && report === currentReport) {
      copyButton.disabled = false;
      readButton.disabled = false;
    }
  }
});

downloadButton.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ai-quota-browser-summary.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
