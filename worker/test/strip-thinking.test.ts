import { describe, expect, it } from 'vitest';
import { stripHermesThinking } from '../src/runtime/consumer';

describe('stripHermesThinking (durable answer backstop)', () => {
  it('strips pipe-framed blocks from the durable answer', () => {
    expect(stripHermesThinking('Final.\n| thinking|\nsecret\n|/thinking|\nDone.'))
      .toBe('Final.\nDone.');
  });

  it('strips soft-pipe framed blocks', () => {
    expect(stripHermesThinking('Final.\n│ thinking│\nsecret\n│/thinking│\nDone.'))
      .toBe('Final.\nDone.');
  });

  it('strips bare  thinking …  response scratchpad blocks', () => {
    expect(stripHermesThinking('Final.\n thinking\nsecret\n response\nDone.'))
      .toBe('Final.\n\nDone.');
  });

  it('strips an unclosed block running to the end of the answer', () => {
    expect(stripHermesThinking('Final.\n| thinking|\nnever closed'))
      .toBe('Final.');
  });

  it('strips stray close-frames and keeps the surrounding answer', () => {
    expect(stripHermesThinking('Final.\n|/thinking|\nDone.')).toBe('Final.\n\nDone.');
  });

  it('still strips classic XML CoT tags', () => {
    expect(stripHermesThinking('Final.\n<thinking>\nsecret\n</thinking>\nDone.'))
      .toBe('Final.\nDone.');
  });

  it('still strips @step: narration chrome', () => {
    expect(stripHermesThinking('@step: Researching now\nFinal answer.')).toBe('\nFinal answer.');
  });

  it('leaves plain answers untouched', () => {
    expect(stripHermesThinking('Just a plain final answer.')).toBe('Just a plain final answer.');
  });
});
