/** Defense-in-depth for runtimes that predate the current runner scrubber.
 * Holds partial markers across SSE deltas and removes inline reasoning before
 * it can reach a live channel. */
export class StreamingThinkScrubber {
  /* The runner already owns the broader pipe/bare-marker vocabulary. This
     compatibility layer deliberately covers XML only, especially MiniMax's
     namespace, so a normal trailing space is never held as a possible bare
     ` thinking` marker for a second time. */
  private static readonly OPEN = [
    '<reasoning_scratchpad>', '<think>', '<mm:think>', '<reasoning>', '<thinking>',
    '<thought>',
  ];

  private static readonly CLOSE = [
    '</reasoning_scratchpad>', '</think>', '</mm:think>', '</reasoning>', '</thinking>',
    '</thought>',
  ];

  private buffer = '';
  private inThinkBlock = false;
  private visible = '';

  push(text: string): string {
    let input = normalizeSoftPipes(`${this.buffer}${text}`);
    this.buffer = '';
    let output = '';

    while (input) {
      const lower = input.toLowerCase();
      if (this.inThinkBlock) {
        const close = earliestTag(lower, StreamingThinkScrubber.CLOSE);
        if (close) {
          this.inThinkBlock = false;
          input = input.slice(close.index + close.length);
          continue;
        }
        const max = Math.max(...StreamingThinkScrubber.CLOSE.map((tag) => tag.length));
        this.buffer = input.slice(-Math.min(max, input.length));
        return output;
      }

      const open = this.earliestOpening(input, lower);
      if (open) {
        output += this.append(input.slice(0, open.index));
        this.inThinkBlock = true;
        input = input.slice(open.index + open.length);
        continue;
      }

      const held = longestTagPrefix(
        lower,
        [...StreamingThinkScrubber.OPEN, ...StreamingThinkScrubber.CLOSE],
      );
      const safe = held ? input.slice(0, -held) : input;
      if (held) this.buffer = input.slice(-held);
      output += this.append(stripOrphanCloseTags(safe));
      return output;
    }
    return output;
  }

  finish(): string {
    if (this.inThinkBlock) {
      this.buffer = '';
      return '';
    }
    const output = this.append(stripOrphanCloseTags(this.buffer));
    this.buffer = '';
    return output;
  }

  private append(text: string): string {
    this.visible += text;
    return text;
  }

  private earliestOpening(input: string, lower: string): TagMatch | null {
    let best: TagMatch | null = null;
    for (const tag of StreamingThinkScrubber.OPEN) {
      let from = 0;
      while (from < lower.length) {
        const index = lower.indexOf(tag, from);
        if (index === -1) break;
        const preceding = input.slice(0, index);
        const lastNewline = preceding.lastIndexOf('\n');
        const boundary = index === 0
          ? this.visible.length === 0 || this.visible.endsWith('\n')
          : lastNewline === -1
            ? (this.visible.length === 0 || this.visible.endsWith('\n')) && prefixBlank(preceding)
            : prefixBlank(preceding.slice(lastNewline + 1));
        if (boundary && (!best || index < best.index)) {
          best = { index, length: tag.length };
          break;
        }
        from = index + 1;
      }
    }
    return best;
  }
}

interface TagMatch {
  index: number;
  length: number;
}

function earliestTag(text: string, tags: readonly string[]): TagMatch | null {
  let best: TagMatch | null = null;
  for (const tag of tags) {
    const index = text.indexOf(tag);
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, length: tag.length };
    }
  }
  return best;
}

function longestTagPrefix(text: string, tags: readonly string[]): number {
  let held = 0;
  for (const tag of tags) {
    for (let length = 1; length < tag.length; length += 1) {
      if (text.endsWith(tag.slice(0, length))) held = Math.max(held, length);
    }
  }
  return held;
}

function stripOrphanCloseTags(text: string): string {
  if (!text.includes('</')) return text;
  return text.replace(
    /<\/(?:[a-z][\w.-]*:)?(?:reasoning_scratchpad|think|reasoning|thinking|thought)>[ \t\r\n]*/gi,
    '',
  );
}

function prefixBlank(line: string): boolean {
  return line.replace(/[│|]/g, '').trim() === '';
}

function normalizeSoftPipes(value: string): string {
  return value.replace(/[│┃┆┊]/g, '|');
}
