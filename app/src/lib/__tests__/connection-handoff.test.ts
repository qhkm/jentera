import { describe, expect, it } from 'vitest';
import { connectionHandoff, hideStreamingConnectionHandoff } from '@/lib/connection-handoff';

const runId = '11111111-1111-4111-8111-111111111111';
const block = (value: unknown) => '```jentera-connect\n' + JSON.stringify(value) + '\n```';

describe('connection setup requests', () => {
  it('extracts only the allowlisted Calendar setup shortcut', () => {
    expect(connectionHandoff('Calendar needs a connection.\n' + block({ connector: 'google_calendar' }), runId))
      .toEqual({ text: 'Calendar needs a connection.', connector: 'google_calendar' });
  });
  it('supports CRLF and preserves subsequent prose', () => {
    const text = ('Connect first.\n' + block({ connector: 'google_calendar' }) + '\nNo event was created.').replace(/\n/g, '\r\n');
    expect(connectionHandoff(text, runId)).toEqual({ text: 'Connect first.\r\n\r\nNo event was created.', connector: 'google_calendar' });
  });
  it.each([
    'Please connect Google Calendar.',
    block({ connector: 'google' }),
    block({ connector: 'gmail' }),
    block({ connector: ['google_calendar'] }),
    block({}), block(null), block([{ connector: 'google_calendar' }]),
    block({ connector: 'google_calendar', url: 'https://example.com' }),
    block({ connector: 'google_calendar', scopes: ['gmail'] }),
    block({ connector: 'google_calendar', password: 'synthetic-secret' }),
    block({ connector: 'google_calendar', code: 'synthetic-code' }),
    block({ connector: 'x'.repeat(129) }),
    block({ connector: 'google_calendar' }) + '\n' + block({ connector: 'google_calendar' }),
    '```jentera-connect\nnot json\n```',
    '> ```jentera-connect\n> {"connector":"google_calendar"}\n> ```',
    '````markdown\n' + block({ connector: 'google_calendar' }) + '\n````',
    '~~~markdown\n' + block({ connector: 'google_calendar' }) + '\n~~~',
    '```jentera-connect\n{"connector":"google_calendar"}',
  ])('rejects malformed, arbitrary or quoted setup instructions: %s', text => {
    expect(connectionHandoff(text, runId)).toEqual({ text });
  });
  it.each([undefined, 'model-chosen-id'])('requires a durable agent run: %s', id => {
    const text = block({ connector: 'google_calendar' });
    expect(connectionHandoff(text, id)).toEqual({ text });
  });
  it('hides complete and incomplete streamed setup blocks without removing later prose', () => {
    expect(hideStreamingConnectionHandoff('Connect first.\n' + block({ connector: 'google_calendar' }) + '\nNothing changed.'))
      .toBe('Connect first.\n\nNothing changed.');
    expect(hideStreamingConnectionHandoff('Connect first.\n```jentera-connect\n{"connector":'))
      .toBe('Connect first.');
    expect(hideStreamingConnectionHandoff('Connect first.\n```jentera-connect'))
      .toBe('Connect first.');
    expect(hideStreamingConnectionHandoff('An ordinary reply.')).toBe('An ordinary reply.');
  });
});
