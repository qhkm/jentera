import { describe, expect, it } from 'vitest';
import { reminderLocalTime, reminderProposal } from '@/lib/reminders';
const id = '11111111-1111-4111-8111-111111111111';
const block = (value: unknown) => '```jentera-reminder\n' + JSON.stringify(value) + '\n```';
const payload = { message: 'Drink water', dueAt: '2026-09-13T02:26:35.000Z', timeZone: 'Asia/Kuala_Lumpur' };

describe('model reminder proposals', () => {
  it('extracts an editable draft with stable run identity', () => {
    expect(reminderProposal('Please confirm.\n' + block({ ...payload, id: 'model-chosen-id' }), id)).toEqual({ text: 'Please confirm.', draft: { id, message: 'Drink water', dueAt: payload.dueAt } });
    expect(reminderLocalTime(payload.dueAt)).toBe('2026-09-13T10:26:35');
  });
  it('leaves ambiguous time empty for the person to choose', () => {
    expect(reminderProposal(block({ ...payload, dueAt: null }), id).draft).toEqual({ id, message: 'Drink water' });
    expect(reminderLocalTime()).toBe('');
  });
  it('rejects ordinary prose, invalid and multiple proposals', () => {
    for (const text of ['remind me in 3 min', block({ ...payload, dueAt: 'tomorrow' }), block({ ...payload, timeZone: 'UTC' }), block({ ...payload, message: '' }), block(payload) + block(payload), '```jentera-reminder\nnot json\n```']) expect(reminderProposal(text, id).draft).toBeUndefined();
    expect(reminderProposal(block(payload)).draft).toBeUndefined();
  });
});
