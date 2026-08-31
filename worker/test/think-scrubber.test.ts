import { describe, expect, it } from 'vitest';
import { StreamingThinkScrubber } from '../src/runtime/think-scrubber';

function scrub(chunks: string[]): string {
  const scrubber = new StreamingThinkScrubber();
  return chunks.map((chunk) => scrubber.push(chunk)).join('') + scrubber.finish();
}

describe('StreamingThinkScrubber', () => {
  it('removes a MiniMax reasoning block split across deltas', () => {
    expect(scrub([
      '<mm:th',
      'ink>private ',
      'reasoning</mm:',
      'think>Honest answer.',
    ])).toBe('Honest answer.');
  });

  it('removes a split orphan MiniMax close tag without truncating the answer', () => {
    expect(scrub(['</mm:', 'thi', 'nk>Honest answer — ', 'complete.']))
      .toBe('Honest answer — complete.');
  });

  it('leaves ordinary streamed answer text unchanged', () => {
    expect(scrub(['I have no ', 'streaming issue.']))
      .toBe('I have no streaming issue.');
  });
});
