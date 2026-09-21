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

  it.each([
    'Continue my earlier request: Check task status\nFirst verify account access before continuing.',
    'Resume the work status investigation',
    'Teruskan permintaan saya sebelum ini: Semak status tugasan',
    'Sambung tugasan status kerja',
  ])('keeps a continuation on the durable path even when its context mentions a fast-path intent: %s', question => {
    expect(automaticAskMode(question)).toBe('work');
    expect(automaticResponseDepth(question)).toBe('quick');
  });

  it('keeps typed research commands as the advanced escape hatch', () => {
    expect(automaticResponseDepth('/research compare these suppliers')).toBe('deep');
    expect(automaticResponseDepth('compare these suppliers')).toBe('quick');
  });
});

describe('setting a service up is a conversation, not a job to track', () => {
  /* It fell through to `work` — not a greeting, not a status question, not a
     question — and arrived as a task card with a status, for something that
     takes two minutes and is then finished. */
  it.each([
    'i want to connect to my bukku account',
    'I want to connect my Bukku account',
    'help me connect Bukku',
    'can you set up my accounting',
    'disconnect telegram',
    'saya nak sambung akaun Bukku saya',
    'tolong sambungkan Bukku',
  ])('routes %s as a conversation', (question) => {
    expect(automaticAskMode(question)).toBe('ask');
  });

  /* And does not swallow the work that happens to mention a connection. */
  it.each([
    'send the invoice to my connected customer list',
    'research which accounting software integrates with Shopee',
    'draft an email about our new integration',
  ])('leaves %s as work', (question) => {
    expect(automaticAskMode(question)).toBe('work');
  });
});
