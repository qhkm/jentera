import { describe, expect, it } from 'vitest';
import { isReminderRequest } from '@/lib/reminders';

describe('direct reminder commands', () => {
  it('recognizes English and BM commands', () => {
    for (const text of ['remind me tomorrow at 9', 'pls set a reminder to call Ali', 'can you schedule reminder for tomorrow', 'tolong ingatkan saya bayar invois']) expect(isReminderRequest(text)).toBe(true);
  });
  it('does not intercept questions, negations or general business work', () => {
    for (const text of ['how do reminders work?', 'do not remind me', 'plan a marketing campaign', 'I think reminders need push', 'can you explain reminders']) expect(isReminderRequest(text)).toBe(false);
  });
});
