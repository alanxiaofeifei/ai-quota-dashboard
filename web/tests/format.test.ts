import { describe, expect, it } from 'vitest';
import { captureState, estimatedReset, formatCredits, formatPercent, formatTimestamp, STALE_AFTER_MS, timestamp } from '../src/format';

const readAt = '2031-04-05T02:03:00.000Z';
const readTime = Date.parse(readAt);

describe('quota values keep their source meaning', () => {
  it('retains genuine zero and full remaining percentages', () => {
    expect(formatPercent(0)).toBe('0');
    expect(formatPercent(100)).toBe('100');
    expect(formatPercent(37.5)).toBe('37.5');
  });
  it('never defaults invalid or missing values to zero', () => {
    for (const value of [undefined, null, '0', NaN, Infinity, -1, 101]) expect(formatPercent(value)).toBe('暂不可用');
    for (const value of [undefined, null, 0, 'USD 0', '1e3', '-1']) expect(formatCredits(value)).toBe('未知');
  });
  it('preserves credits as decimal strings, including zero', () => {
    expect(formatCredits('0')).toBe('0');
    expect(formatCredits('12.7500')).toBe('12.7500');
    expect(formatPercent(37)).toBe('37');
  });
});

describe('capture age and timezone', () => {
  it('marks age from the original page read, rather than import time', () => {
    expect(captureState(readAt, readTime + STALE_AFTER_MS - 1)).toBe('recent');
    expect(captureState(readAt, readTime + STALE_AFTER_MS)).toBe('stale');
    expect(captureState(readAt, readTime + 6 * 3600000)).toBe('stale');
  });
  it('leaves invalid and implausibly future times unknown', () => {
    expect(captureState('not-a-time', readTime)).toBe('unknown');
    expect(captureState(readAt, readTime - 301000)).toBe('unknown');
    expect(timestamp('04/05/2031')).toBeNull();
  });
  it('formats timezone differences without changing UTC or age', () => {
    const original = readAt;
    expect(formatTimestamp(readAt, 'Asia/Taipei')).toContain('10:03');
    expect(formatTimestamp(readAt, 'UTC')).toContain('02:03');
    expect(readAt).toBe(original);
    expect(captureState(readAt, readTime + STALE_AFTER_MS)).toBe('stale');
  });
  it('handles a daylight-saving transition using timezone rules', () => {
    expect(formatTimestamp('2029-03-11T06:30:00.000Z', 'America/New_York')).toContain('01:30');
    expect(formatTimestamp('2029-03-11T07:30:00.000Z', 'America/New_York')).toContain('03:30');
    expect(formatTimestamp(readAt, 'invalid/zone')).toBe('未知');
  });
});

describe('estimated reset never implies restoration', () => {
  it('bases an estimate on page-read time, not a later import', () => {
    const result = estimatedReset(readAt, 2 * 3600, readTime + 3600000);
    expect(result.at).toBe(readTime + 2 * 3600000);
    expect(result.text).toBe('预计约 1 小时后重置');
  });
  it('retains unknown when no reset was supplied', () => {
    expect(estimatedReset(readAt, null, readTime).state).toBe('unknown');
    expect(estimatedReset(readAt, -1, readTime).at).toBeNull();
    expect(estimatedReset(readAt, 367 * 86400, readTime).at).toBeNull();
  });
  it('only asks for a new page read after the expected time', () => {
    const observation = { remaining_percent: 37, page_read_at: readAt };
    const result = estimatedReset(observation.page_read_at, 3600, readTime + 3600000);
    expect(result.state).toBe('due');
    expect(result.text).toContain('尚未确认恢复');
    expect(observation.remaining_percent).toBe(37);
  });
  it('does not estimate after a substantial clock reversal', () => {
    expect(estimatedReset(readAt, 3600, readTime - 301000).state).toBe('unknown');
  });
});
