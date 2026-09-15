import { describe, expect, it, vi } from 'vitest';
import { createAnswerStreamGate, heldProgressLabel, streamHoldReason } from '../src/answer-stream-policy';
import { guardAnswer } from '../src/answer-guardrails';
import { supportedReview } from '../src/source-review';

// Offline regressions: deterministic policy/evidence tests, NOT an assertion
// that a live model never hallucinates. Both languages and false positives matter.
const held = [
  ['invented version', 'What is the latest DeepSeek release?', 'Version 99 launched today.'],
  ['BM invented version', 'Apa model terbaru hari ini?', 'Versi 99 dilancarkan hari ini.'],
  ['fake citation', 'Latest model pricing?', '[Price](https://invented.invalid/price)'],
  ['wrong date', 'What happened today?', 'Today is 1 January 2030.'],
  ['false done', 'Send the email', 'Sent successfully!'],
  ['BM false done', 'Tolong hantar emel', 'Sudah dihantar!'],
  ['install', 'Install the app', 'Installed.'],
  ['BM schedule', 'Ingatkan saya minum air', 'Peringatan telah dijadualkan.'],
  ['medical', 'What medicine dosage should I take?', 'Take ten tablets.'],
  ['BM medical', 'Berapa dos ubat saya?', 'Ambil sepuluh tablet.'],
  ['financial', 'Calculate my monthly cost', 'Exactly $24, measured.'],
  ['BM financial', 'Semak kos bulanan', 'Tepat RM100, telah diukur.'],
  ['tax', 'What tax applies to this?', 'No tax applies.'],
  ['BM tax', 'Berapa cukai untuk ini?', 'Tiada cukai.'],
  ['legal', 'Is this legal?', 'Definitely legal.'],
  ['ambiguous followup', 'yes', 'Done.'],
  ['BM ambiguous followup', 'teruskan', 'Siap.'],
];

describe('EN/BM high-risk streaming regression set', () => {
  it.each(held)('holds %s before any answer token reaches either channel', async (_name, question, answer) => {
    const gate = createAnswerStreamGate(question);
    const web = vi.fn(), telegram = vi.fn();
    for (const char of answer) await gate.forward(char, async text => { web(text); telegram(text); });
    expect(gate.reason).not.toBeNull();
    expect(web).not.toHaveBeenCalled();
    expect(telegram).not.toHaveBeenCalled();
  });
  it.each(['Hello', 'Write a poem about cats', 'Draft marketing ideas', 'Tulis puisi tentang kucing', 'Cadangkan idea pemasaran'])('keeps low-risk conversation streaming: %s', async question => {
    expect(streamHoldReason(question)).toBeNull();
    const emit = vi.fn(async () => {});
    await createAnswerStreamGate(question).forward('Hello', emit);
    expect(emit).toHaveBeenCalledWith('Hello');
  });
  it('closes the gate on tool use and holds resumed previews', async () => {
    const gate = createAnswerStreamGate('Explain this concept');
    gate.toolStarted();
    const emit = vi.fn(async () => {});
    await gate.forward('Claimed result', emit);
    await createAnswerStreamGate('Hello', true).forward('Old replay', emit);
    expect(emit).not.toHaveBeenCalled();
  });
  it('keeps progress visible without completion claims through the step lane', () => {
    expect(heldProgressLabel('Checking the sources')).toBe('Checking the sources');
    expect(heldProgressLabel('Menyemak sumber')).toBe('Menyemak sumber');
    expect(heldProgressLabel('Sent successfully')).toBe('Checking the task');
    expect(heldProgressLabel('Checking price is $100')).toBe('Checking the task');
    expect(heldProgressLabel('API says 57', 'current_information')).toBe('Checking current sources');
    expect(heldProgressLabel('Sent successfully', 'action')).toBe('Checking the requested action');
    expect(heldProgressLabel('Harga ialah RM100', 'high_stakes')).toBe('Checking important details');
    expect(heldProgressLabel('Menyemak harga RM100', 'high_stakes')).toBe('Menyemak butiran penting');
  });
  it('warns on unsourced high-stakes answers in both languages', () => {
    expect(guardAnswer('Take ten tablets.', 'What medicine dosage?', null).warnings).toContain('missing_current_sources');
    expect(guardAnswer('Ambil sepuluh tablet.', 'Berapa dos ubat saya?', null).warnings).toContain('missing_current_sources');
  });
  it('rejects an invented version or date with a fabricated quote', () => {
    for (const claim of ['Version 99 launched today.', 'Today is 1 January 2030.']) {
      expect(supportedReview({ coversAll: true, claims: [{ claim, source: 0, quote: claim, supported: true }] },
        claim, ['Version 1 was released on 1 January 2020.'])).toBe(false);
    }
  });
});
