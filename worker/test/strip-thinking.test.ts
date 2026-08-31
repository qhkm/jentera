import { describe, expect, it } from 'vitest';
import { finalDurableText, stripHermesThinking } from '../src/runtime/consumer';

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

describe('finalDurableText (durable 💭 Reasoning block)', () => {
  it('prepends the reasoning block before the answer', () => {
    expect(finalDurableText('The answer.', 'Think first.\nThen answer.'))
      .toBe('💭 **Reasoning:**\n```\nThink first.\nThen answer.\n```\n\nThe answer.');
  });

  it('collapses reasoning beyond 15 lines with a _... (N more lines)_ suffix', () => {
    const reasoning = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(finalDurableText('Answer.', reasoning)).toBe(
      '💭 **Reasoning:**\n```\n' +
        Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n') +
        '\n_... (5 more lines)_\n```\n\nAnswer.',
    );
  });

  it('returns just the answer when reasoning is absent', () => {
    expect(finalDurableText('Answer.', undefined)).toBe('Answer.');
    expect(finalDurableText('Answer.', '   ')).toBe('Answer.');
  });

  it('still strips inline thinking from the answer portion', () => {
    expect(finalDurableText('Final.\n<thinking>\nsecret\n</thinking>\nDone.', 'Plan.'))
      .toBe('💭 **Reasoning:**\n```\nPlan.\n```\n\nFinal.\nDone.');
  });

  it('keeps the block and truncates the answer inside the Telegram 4k cap', () => {
    const reasoning = 'r'.repeat(1_000);
    const answer = 'a'.repeat(4_000);
    const text = finalDurableText(answer, reasoning);
    expect(text.length).toBe(4_000);
    expect(text.startsWith('💭 **Reasoning:**\n```\n')).toBe(true);
    expect(text.includes('a'.repeat(500))).toBe(true);
  });
});
