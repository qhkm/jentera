import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserInput, type DirectInputCommand } from '@/lib/browser-input';
import type { BusinessBrowserState } from '@/lib/repo/types';

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const frame = (id = FIRST, sequence = 1, kind: 'text' | 'password' | 'control' = 'text'): BusinessBrowserState =>
  ({ directTyping: 1, inputTarget: { id, kind, nextSequence: sequence } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture(handler?: (command: DirectInputCommand) => Promise<BusinessBrowserState | null>) {
  const dispatch = vi.fn(handler ?? (async command => frame(FIRST, command.action === 'input' ? command.sequence + 1 : 1)));
  const change = vi.fn();
  const interrupted = vi.fn();
  return { input: new BrowserInput(dispatch, change, interrupted), dispatch, change, interrupted };
}

it('ignores input before a field is explicitly selected and batches adjacent characters', async () => {
  const f = fixture();
  f.input.text('ignored'); f.input.key('Enter');
  expect(f.dispatch).not.toHaveBeenCalled();
  f.input.select(12, 34);
  f.input.text('h'); f.input.text('e'); f.input.text('llo');
  await vi.runAllTimersAsync();
  expect(f.dispatch.mock.calls.map(([command]) => command)).toEqual([
    { action: 'click', x: 12, y: 34 },
    { action: 'input', inputId: FIRST, sequence: 1, text: 'hello' },
  ]);
});

it('retains ordered input while selection and typing requests are in flight', async () => {
  let finish!: (value: BusinessBrowserState) => void;
  const f = fixture(async command => command.action === 'click'
    ? new Promise(resolve => { finish = resolve; }) : frame(FIRST, command.sequence + 1));
  f.input.select(10, 20); await vi.advanceTimersByTimeAsync(0);
  f.input.text('secret'); f.input.key('Backspace'); f.input.text('t');
  finish(frame(FIRST, 1, 'password')); await vi.runAllTimersAsync();
  expect(f.dispatch.mock.calls.slice(1).map(([command]) => command)).toEqual([
    { action: 'input', inputId: FIRST, sequence: 1, text: 'secret' },
    { action: 'input', inputId: FIRST, sequence: 2, key: 'Backspace' },
    { action: 'input', inputId: FIRST, sequence: 3, text: 't' },
  ]);
});

it('only retargets queued text after an explicit Tab or field click', async () => {
  let id = FIRST;
  const f = fixture(async command => {
    if (command.action === 'click') return frame(id);
    if ('key' in command && command.key === 'Tab') { id = SECOND; return frame(id, 1, 'password'); }
    return frame(id, command.sequence + 1);
  });
  f.input.select(1, 2); f.input.text('email'); f.input.key('Tab'); f.input.text('password');
  await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenLastCalledWith({ action: 'input', inputId: SECOND, sequence: 1, text: 'password' });
  expect(f.interrupted).not.toHaveBeenCalled();
});

it('supports Tab to a submit button and Enter without typing text into controls', async () => {
  const f = fixture(async command => command.action === 'click' ? frame()
    : 'key' in command && command.key === 'Tab' ? frame(SECOND, 1, 'control')
    : frame(SECOND, command.sequence + 1, 'control'));
  f.input.select(1, 2); f.input.key('Tab'); f.input.key('Enter'); await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenLastCalledWith({ action: 'input', inputId: SECOND, sequence: 1, key: 'Enter' });
  f.input.text('must-not-type'); await vi.runAllTimersAsync();
  expect(f.dispatch.mock.calls.some(([command]) => 'text' in command)).toBe(false);
  expect(f.interrupted).toHaveBeenCalledOnce();
});

it('stops and drops queued credentials if focus changes unexpectedly', async () => {
  const f = fixture(async command => command.action === 'click' ? frame() : frame(SECOND));
  f.input.select(1, 2); f.input.text('first'); f.input.key('Backspace'); f.input.text('never-send');
  await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  expect(f.interrupted).toHaveBeenCalledOnce();
});

it('does not retry a failed/ambiguous request or send following characters', async () => {
  const f = fixture(async command => command.action === 'click' ? frame() : null);
  f.input.select(1, 2); f.input.text('first'); f.input.key('Enter');
  await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  expect(f.interrupted).toHaveBeenCalledOnce();
  f.input.text('ignored'); await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenCalledTimes(2);
});

it('does not carry pending input across Enter navigation', async () => {
  const f = fixture(async command => command.action === 'click' ? frame() : frame(SECOND));
  f.input.select(1, 2); f.input.key('Enter'); f.input.text('old-page-secret');
  await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  expect(f.interrupted).not.toHaveBeenCalled();
});

it('invalidates a ready field on polling but ignores obsolete polls during own selection', async () => {
  const f = fixture(); f.input.select(1, 2); f.input.observe({});
  await vi.runAllTimersAsync();
  f.input.observe(frame(SECOND)); f.input.text('ignored'); await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

it('clears pending text on close/hand-back and cannot restore an old acknowledgement', async () => {
  let finish!: (value: BusinessBrowserState) => void;
  const f = fixture(async () => new Promise(resolve => { finish = resolve; }));
  f.input.select(1, 2); await vi.advanceTimersByTimeAsync(0);
  f.input.text('unsent'); f.input.reset(); finish(frame()); await vi.runAllTimersAsync();
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.change).toHaveBeenLastCalledWith({ phase: 'idle' });
});

it('bounds pending plaintext and requires another selection after overflow', async () => {
  const f = fixture(); f.input.select(1, 2); f.input.text('x'.repeat(4097)); await vi.runAllTimersAsync();
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.interrupted).toHaveBeenCalledOnce();
});

it('preserves a newer explicit field click when a slow earlier click selected no field', async () => {
  let finish!: (value: BusinessBrowserState) => void;
  const f = fixture(async command => command.action === 'click' && command.x === 1
    ? new Promise(resolve => { finish = resolve; })
    : frame(FIRST, command.action === 'input' ? command.sequence + 1 : 1));
  f.input.select(1, 2); await vi.advanceTimersByTimeAsync(0);
  f.input.text('wrong-selection'); f.input.select(3, 4); f.input.text('right-selection');
  finish({ directTyping: 1, inputTarget: null }); await vi.runAllTimersAsync();
  expect(f.dispatch.mock.calls.map(([command]) => command)).toEqual([
    { action: 'click', x: 1, y: 2 }, { action: 'click', x: 3, y: 4 },
    { action: 'input', inputId: FIRST, sequence: 1, text: 'right-selection' },
  ]);
  expect(f.interrupted).not.toHaveBeenCalled();
});
