import { describe, expect, it } from 'vitest';
import { ApiError, safeErrorMessage } from '../src/api';
import { isProgramManifestFilename, MAX_SUMMARY_BYTES, parseSummaryText } from '../src/import';

describe('user-supplied summary text', () => {
  it('decodes JSON without changing measurements or claiming validation', () => {
    const report = { remaining_percent: 37, credits_balance: null };
    expect(parseSummaryText(JSON.stringify(report))).toEqual(report);
    // Contract validation belongs to the local server, including arbitrary JSON.
    expect(parseSummaryText('null')).toBeNull();
  });
  it('enforces UTF-8 byte limits for pasted text, not character counts', () => {
    expect(parseSummaryText('"' + 'a'.repeat(MAX_SUMMARY_BYTES - 2) + '"')).toHaveLength(MAX_SUMMARY_BYTES - 2);
    const multibyte = '"' + '字'.repeat(12000) + '"';
    expect(multibyte.length).toBeLessThan(MAX_SUMMARY_BYTES);
    expect(() => parseSummaryText(multibyte)).toThrowError(expect.objectContaining({ code: 'body_too_large' }));
  });
  it('returns fixed errors without reflecting malformed pasted content', () => {
    let failure: unknown;
    try { parseSummaryText('not-json-private-example'); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ApiError);
    expect(safeErrorMessage(failure)).not.toContain('not-json-private-example');
  });
});

describe('program metadata cannot be mistaken for downloaded quota files', () => {
  it('recognizes known package metadata names before reading their contents', () => {
    for (const name of ['manifest.json', 'SOURCE_MANIFEST.json', 'THIRD_PARTY_MANIFEST.json', 'core-backup.json']) {
      expect(isProgramManifestFilename(name)).toBe(true);
    }
    expect(isProgramManifestFilename('quota-usage-summary.json')).toBe(false);
    expect(safeErrorMessage(new ApiError(400, 'not_quota_summary'))).toContain('许可或源码清单');
  });
});
