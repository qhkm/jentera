import { describe, expect, it } from 'vitest';
import { liveEvent, rememberLive } from '../src/run-stream-events';

describe('the run stream remembers the agent\'s latest status for late subscribers', () => {
  /* Live events are broadcast, not stored. A browser that connects after the
     intake's first status lines went out saw "Queued securely…" until the
     next live event, which mid-tool could be many seconds away. The latest
     status or thinking line is kept and replayed on connect; answer text is
     not (Postgres holds the durable answer). */
  it('keeps the latest status or thinking line and ignores answer deltas', () => {
    const status = liveEvent({ type: 'status', detail: '✅ Agent started — thinking…' })!;
    const thinking = liveEvent({ type: 'thinking', detail: 'checking the calendar' })!;
    const delta = liveEvent({ type: 'delta', text: 'We are ' })!;
    expect(rememberLive(undefined, status)).toEqual(status);
    expect(rememberLive(status, thinking)).toEqual(thinking);
    expect(rememberLive(thinking, delta)).toEqual(thinking);
    expect(rememberLive(undefined, delta)).toBeUndefined();
  });
});
