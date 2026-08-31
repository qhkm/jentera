/* ============================================================
   Live step narration for the working bubble.

   The ask prompt invites the agent to emit short `@step:` lines
   (e.g. "@step: Checking the MySQL docs…") between tool calls so
   the owner can watch what is happening in real time instead of
   staring at a static "Working…" ticker. The runner relays them
   as ordinary message deltas, so this module pulls them out of
   the answer stream before they reach the reply bubble.

  Rules:
  - A step line is a line whose first non-space characters are
    `@step:` — optionally wrapped in the markdown the model tends
    to add (`**@step:**`, `*@step:*`) or prefixed with a bullet
    (`- @step:`, `• @step:`, `> @step:`). It is consumed entire
    and NEVER forwarded as answer text (the final durable answer
    comes from the runner's status output, so losing the narration
    in the preview lane is safe).
  - Labels split across model token deltas are buffered until the
    line's newline arrives.
  - Total step bytes are capped so a faulty model cannot spend the
    stream budget on narration; excess step lines are dropped.
  - Sanitising keeps the label to plain, short, safe text (the
    bubble edit is plain-text; control characters are removed).
  ============================================================ */

/* Tolerant step-marker matcher. Accepts the bare `@step:` form plus
   the common ways models decorate it: leading markdown emphasis
   (`*@step:*`, `**@step:**`), bullet/quote prefixes (`-`, `•`, `>`),
   and trailing emphasis after the colon (`@step:**Label**`).
   Anything a line-start `@step:` variant can look like in the wild
   should be consumed here so raw narration can never reach the
   answer bubble. */
/* Tolerant step-marker matcher. Accepts the bare `@step:` form plus
   the common ways models decorate it: leading markdown emphasis
   (`*@step:*`, `**@step:**`), bullet/quote prefixes (`-`, `•`, `>`),
   the two combined (`- **@step:**`), and trailing emphasis after the
   colon (`@step:**Label**`). Anything a line-start `@step:` variant can
   look like in the wild should be consumed here so raw narration can
   never reach the answer bubble. */
export const STEP_LINE =
  /^\s*(?:[-*•>]\s*)?(?:\*\*|\*)?\s*@step:[*_]{0,2}\s*/;

/* Whole-line matchers for defensive stripping (blank line + mixed
   `@step:` fragments should not survive either). */
export const STEP_STRIP_RE =
  /(?:^|\n)\s*(?:[-*•>]\s*)?(?:\*\*|\*)?\s*@step:[*_]{0,2}[^\n]*/g;

const STEP_LABEL_LIMIT = 90;
const STEP_BUDGET_DEFAULT = 8 * 1024;

export interface StepProgress {
  /** Complete @step labels discovered in this chunk (sanitised). */
  steps: string[];
  /** Non-step text from this chunk, forwarded unchanged. */
  rest: string;
}

export interface StepProgressExtractor {
  push(delta: string): StepProgress;
  /** Emit whatever is still buffered when the stream ends. */
  flush(): StepProgress;
}

function sanitiseStep(label: string): string {
  return label
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    /* Stray markdown emphasis a tolerant matcher may have left around the
       label (`**@step: X**` → `X`): the bubble edit is plain text, so the
       asterisks are noise, not formatting. */
    .replace(/[*_`~]+/g, '')
    .trim()
    .slice(0, STEP_LABEL_LIMIT);
}

export function createStepProgressExtractor(
  budget = STEP_BUDGET_DEFAULT,
): StepProgressExtractor {
  let buffer = '';
  let budgetBytes = 0;

  const takeLine = (line: string): StepProgress => {
    if (!STEP_LINE.test(line)) return { steps: [], rest: '' };
    const label = sanitiseStep(line.replace(STEP_LINE, ''));
    if (!label || budgetBytes >= budget) return { steps: [], rest: '' };
    budgetBytes += label.length;
    return { steps: [label], rest: '' };
  };

  return {
    push(delta: string): StepProgress {
      buffer += delta;
      const steps: string[] = [];
      let rest = '';
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const taken = takeLine(line);
        if (taken.steps.length > 0) {
          steps.push(...taken.steps);
        } else {
          rest += `${line}\n`;
        }
        nl = buffer.indexOf('\n');
      }
      /* A partial line that begins with the step marker is a step still
         in flight (the model's tokens split it); wait for its newline.
         Any other partial line is answer text and may stream at once. */
      if (buffer && !STEP_LINE.test(buffer)) {
        rest += buffer;
        buffer = '';
      }
      return { steps, rest };
    },

    flush(): StepProgress {
      if (!buffer) return { steps: [], rest: '' };
      const text = buffer;
      buffer = '';
      if (STEP_LINE.test(text)) return takeLine(text);
      return { steps: [], rest: text };
    },
  };
}
