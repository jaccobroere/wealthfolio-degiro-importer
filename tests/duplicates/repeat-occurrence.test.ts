import { describe, expect, it } from 'vitest';

import type { ActivityDraft } from '../../src/domain/activity-draft';
import { occurrenceComment, repeatOccurrences } from '../../src/duplicates/repeat-occurrence';

function dividend(time: string, opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    date: `2024-11-14T${time}:00+01:00`,
    isin: 'IE00SYN00002',
    symbol: 'IE00SYN00002',
    quantity: '1',
    activityType: 'DIVIDEND',
    unitPrice: '0.61',
    currency: 'USD',
    fee: '0',
    amount: '0.61',
    comment: 'Dividend',
    sourceRowNumbers: [1],
    isValid: true,
    errors: {},
    warnings: {},
    ...opts,
  };
}

describe('repeatOccurrences', () => {
  it('numbers identical same-day activities in input order', () => {
    const drafts = [dividend('07:58'), dividend('08:10'), dividend('08:15')];
    expect(repeatOccurrences(drafts)).toEqual([1, 2, 3]);
  });

  it('leaves different days, amounts or securities alone', () => {
    const drafts = [
      dividend('07:58'),
      dividend('07:58', { date: '2024-11-15T07:58:00+01:00' }),
      dividend('07:58', { amount: '0.62', unitPrice: '0.62' }),
      dividend('07:58', { isin: 'IE00SYN00003', symbol: 'IE00SYN00003' }),
    ];
    expect(repeatOccurrences(drafts)).toEqual([1, 1, 1, 1]);
  });
});

describe('occurrenceComment', () => {
  it('keeps the first copy unchanged and numbers the rest', () => {
    expect(occurrenceComment('Dividend', 1)).toBe('Dividend');
    expect(occurrenceComment('Dividend', 2)).toBe('Dividend #2');
    expect(occurrenceComment(undefined, 3)).toBe('#3');
  });
});
