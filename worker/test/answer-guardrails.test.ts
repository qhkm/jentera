import { describe, expect, it } from 'vitest';
import { guardAnswer } from '../src/answer-guardrails';

describe('minimum-evidence answer guardrails', () => {
  it('flags unsourced current claims without inventing a replacement answer', () => {
    const checked = guardAnswer('Version 9 launched today.', 'What is the latest release?', null);
    expect(checked.warnings).toEqual(['missing_current_sources']);
    expect(checked.result).toContain('Verification note');
    expect(checked.result).toContain('Version 9 launched today.');
  });
  it('does not label a citation as factually verified', () => {
    const answer = 'See [release notes](https://example.com/release).';
    expect(guardAnswer(answer, 'Latest release?', null)).toEqual({ result: answer, warnings: [] });
  });
  it('leaves ordinary drafts and business advice unchanged', () => {
    expect(guardAnswer('Try three posts a week.', 'Plan my marketing', null).warnings).toEqual([]);
  });
  it('warns about unsupported completion and preserves artifacts in structured output', () => {
    const checked = guardAnswer({ text: 'Sent!', files: ['report.pdf'] }, 'Send the report', {
      kind: 'conversation', status: 'completed', classification: 'uncertain', uncertaintyReason: 'missing_external_verification',
    });
    expect(checked.warnings).toEqual(['unverified_completion']);
    expect(checked.result).toMatchObject({ files: ['report.pdf'], text: expect.stringContaining('before trying again') });
  });
  it('is idempotent and handles Malay and empty replies', () => {
    const first = guardAnswer('Berita hari ini.', 'Semak berita terkini', null);
    expect(first.result).toContain('Nota pengesahan');
    expect(guardAnswer(first.result, 'Semak berita terkini', null).result).toBe(first.result);
    expect(guardAnswer(null, 'Latest news', null).warnings).toEqual([]);
  });
});
