import { describe, expect, it } from 'vitest';
import { automaticAskMode, automaticResponseDepth } from '@/lib/ask-routing';

describe('automatic Ask routing', () => {
  it.each([
    'What is our address?',
    'Are we open on Sunday?',
    'What happened today?',
    'Give me an update on pending approvals',
    'Apakah alamat perniagaan kita?',
    'Apa yang perlukan perhatian saya?',
  ])('uses the fast business-answer path for %s', (question) => {
    expect(automaticAskMode(question)).toBe('ask');
  });

  it.each([
    'How bad is the haze today in Malaysia?',
    'Draft a reply to this customer',
    'Research our competitors',
    'Send the invoice',
    'Semak jerebu hari ini',
    'Sediakan laporan jualan',
  ])('uses the durable agent for %s', (question) => {
    expect(automaticAskMode(question)).toBe('work');
  });

  it('always sends an attachment to the durable agent', () => {
    expect(automaticAskMode('What stands out?', true)).toBe('work');
  });

  it('keeps typed research commands as the advanced escape hatch', () => {
    expect(automaticResponseDepth('/research compare these suppliers')).toBe('deep');
    expect(automaticResponseDepth('compare these suppliers')).toBe('quick');
  });
});
