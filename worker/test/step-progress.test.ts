import { describe, expect, it } from 'vitest';
import { createStepProgressExtractor, STEP_STRIP_RE } from '../src/runtime/step-progress';

describe('step progress extractor', () => {
  it('splits a complete @step line out of the answer stream', () => {
    const extractor = createStepProgressExtractor();
    const first = extractor.push('@step: Checking the docs…\n');
    expect(first.steps).toEqual(['Checking the docs…']);
    expect(first.rest).toBe('');
    const rest = extractor.push('Here is the answer.');
    expect(rest.steps).toEqual([]);
    expect(rest.rest).toBe('Here is the answer.');
  });

  it('keeps non-step lines and blank separators in the answer text', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('\n@step: Looking things up…\n\nYes, we are open.');
    expect(out.steps).toEqual(['Looking things up…']);
    expect(out.rest).toBe('\n\nYes, we are open.');
  });

  it('buffers a step label split across model token deltas', () => {
    const extractor = createStepProgressExtractor();
    expect(extractor.push('@step: Chec')).toEqual({ steps: [], rest: '' });
    expect(extractor.push('king the SQL')).toEqual({ steps: [], rest: '' });
    const finished = extractor.push(' schema…\nAnswer follows.');
    expect(finished.steps).toEqual(['Checking the SQL schema…']);
    expect(finished.rest).toBe('Answer follows.');
  });

  it('streams partial answer text immediately while a step is pending', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('@step: Nearly done');
    expect(out.steps).toEqual([]);
    expect(out.rest).toBe('');
    /* The newline completes the step line (the newline belongs to the step,
       not the answer); the remaining text is forwarded right away. */
    const second = extractor.push('\ntext after');
    expect(second.steps).toEqual(['Nearly done']);
    expect(second.rest).toBe('text after');
  });

  it('forwards a final partial non-step line immediately (flush has nothing left)', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('The answer ends without a newline');
    expect(out.steps).toEqual([]);
    expect(out.rest).toBe('The answer ends without a newline');
    expect(extractor.flush()).toEqual({ steps: [], rest: '' });
  });

  it('drops an unterminated step line on flush', () => {
    const extractor = createStepProgressExtractor();
    extractor.push('@step: Interrupted mid-');
    expect(extractor.flush()).toEqual({ steps: ['Interrupted mid-'], rest: '' });
  });

  it('sanitises labels: trims, collapses whitespace, removes control chars, caps length', () => {
    const extractor = createStepProgressExtractor();
    const { steps } = extractor.push('@step:   double   spaces and a\u0000nul\u0007 control   \n');
    expect(steps[0]).toBe('double spaces and a nul control');
    expect(steps[0].length).toBeLessThanOrEqual(90);
  });

  it('honours the step byte budget and drops excess lines', () => {
    const extractor = createStepProgressExtractor(10);
    expect(extractor.push('@step: twelve chars!\n@step: over budget\n').steps)
      .toEqual(['twelve chars!']);
    /* Over-budget lines are dropped entirely (never forwarded as answer). */
    const out = extractor.push('ok');
    expect(out.rest).toBe('ok');
  });

  it('treats a line merely containing @step: mid-text as answer text', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('Read the docs at @step: is not a marker here.\n');
    expect(out.steps).toEqual([]);
    expect(out.rest).toBe('Read the docs at @step: is not a marker here.\n');
  });

  it('consumes bold-decorated step lines and strips the markdown', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('**@step: Checking the booking docs**\nAnswer.');
    expect(out.steps).toEqual(['Checking the booking docs']);
    expect(out.rest).toBe('Answer.');
  });

  it('consumes a bold marker with a plain label', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('**@step:** Scanning invoices\n');
    expect(out.steps).toEqual(['Scanning invoices']);
    expect(out.rest).toBe('');
  });

  it('consumes bullet and quote-prefixed step lines', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('- @step: First pass\n• @step: Second pass\n> @step: Third pass\nafter');
    expect(out.steps).toEqual(['First pass', 'Second pass', 'Third pass']);
    expect(out.rest).toBe('after');
  });

  it('strips trailing emphasis from the label', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('@step: Check the SQL**\n');
    expect(out.steps).toEqual(['Check the SQL']);
  });

  it('strips inline markdown noise from labels', () => {
    const extractor = createStepProgressExtractor();
    const out = extractor.push('@step: **Install** `deps` now\n');
    expect(out.steps).toEqual(['Install deps now']);
  });

  it('STEP_STRIP_RE: defensive whole-line strip handles decorated variants', () => {
    const answer = 'First line\n- **@step: Sneaky narration**\n• @step: Another one\nReal answer.';
    const stripped = answer.replace(STEP_STRIP_RE, '');
    expect(stripped).toBe('First line\nReal answer.');
  });

  it('STEP_STRIP_RE: leaves a mid-line occurrence alone (extractor owns that case)', () => {
    const answer = 'Read the docs at @step: is not a marker here.';
    expect(answer.replace(STEP_STRIP_RE, '')).toBe(answer);
  });
});
