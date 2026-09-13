import { expect, it } from 'vitest';
import { confirmedStop, stoppedRunOutcome } from '../src/runtime/run-task';

it.each([null, {}, { ok: true }, { status: 'running' }, { status: 'expiring' }, { status: 'quarantined' }])('does not confirm an ambiguous stop: %j', (response) => {
  expect(() => confirmedStop(response)).toThrow('may still be running');
});

it('preserves completion when the task finishes before the stop reaches it', () => {
  const outcome = stoppedRunOutcome({ status: 'completed', output: 'Saved result', usage: { input_tokens: 12, output_tokens: 8 } }, 'remote-id', { input: 'do work' });
  expect(outcome).toMatchObject({ state: 'terminal', remoteStatus: 'completed', result: 'Saved result', usage: { inputTokens: 12, outputTokens: 8 } });
});

it('does not invent zero usage when termination omits it', () => {
  expect(stoppedRunOutcome({ status: 'expired', error: 'run deadline exceeded' }, 'remote-id', { input: 'do work' }))
    .toMatchObject({ state: 'terminal', remoteStatus: 'expired', usage: undefined });
});
