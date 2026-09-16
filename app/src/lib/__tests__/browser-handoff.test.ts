import { describe, expect, it } from 'vitest';
import { browserHandoff, hideStreamingBrowserHandoff } from '@/lib/browser-handoff';

const runId = '11111111-1111-4111-8111-111111111111';
const block = (value: unknown) => '```jentera-browser\n' + JSON.stringify(value) + '\n```';

describe('browser handoff requests', () => {
  it.each(['sign_in', 'mfa', 'user_action'])('extracts a display-only %s request', reason => {
    expect(browserHandoff('I need your help.\n\n' + block({ reason }), runId))
      .toEqual({ text: 'I need your help.', reason });
  });
  it('supports CRLF and keeps text following the card marker', () => {
    const text = ('Sign in.\n' + block({ reason: 'sign_in' }) + '\nNothing was changed.').replace(/\n/g, '\r\n');
    expect(browserHandoff(text, runId)).toEqual({ text: 'Sign in.\r\n\r\nNothing was changed.', reason: 'sign_in' });
  });
  it.each([
    'Open the business browser and sign in.',
    block({ reason: 'approve' }),
    block({ reason: ['sign_in'] }),
    block({}),
    block(null),
    block([{ reason: 'mfa' }]),
    block({ reason: 'sign_in', url: 'https://example.com' }),
    block({ reason: 'sign_in', password: 'synthetic-secret' }),
    block({ reason: 'x'.repeat(129) }),
    block({ reason: 'mfa' }) + '\n' + block({ reason: 'sign_in' }),
    '```jentera-browser\nnot json\n```',
    '> ```jentera-browser\n> {"reason":"sign_in"}\n> ```',
    '````markdown\n' + block({ reason: 'sign_in' }) + '\n````',
    '~~~markdown\n' + block({ reason: 'mfa' }) + '\n~~~',
  ])('does not turn malformed, quoted, or arbitrary instructions into an action', text => {
    expect(browserHandoff(text, runId)).toEqual({ text });
  });
  it.each([undefined, 'model-chosen-id'])('requires a durable run identity (%s)', id => {
    const text = block({ reason: 'sign_in' });
    expect(browserHandoff(text, id)).toEqual({ text });
  });
  it('hides complete and incomplete markers while streaming without removing subsequent prose', () => {
    expect(hideStreamingBrowserHandoff('Please sign in.\n' + block({ reason: 'mfa' }) + '\nNothing changed.'))
      .toBe('Please sign in.\n\nNothing changed.');
    expect(hideStreamingBrowserHandoff('Please sign in.\n```jentera-browser\n{"reason":'))
      .toBe('Please sign in.');
    expect(hideStreamingBrowserHandoff('Please sign in.\n```jentera-browser'))
      .toBe('Please sign in.');
    expect(hideStreamingBrowserHandoff('An ordinary reply.')).toBe('An ordinary reply.');
  });
});
