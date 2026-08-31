import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamingThinkScrubber } from '../src/server.mjs';

/** Feed a full message through the scrubber the way server.mjs does. */
function run(message) {
  const scrubber = new StreamingThinkScrubber();
  let visible = '';
  const chunks = message.match(/[\s\S]{1,7}/g) ?? [message]; // stream in 7-char chunks
  for (const chunk of chunks) visible += scrubber.push(chunk);
  const tail = scrubber.finish();
  return { visible: visible + tail, thinking: scrubber.drainThinking() };
}

test('pipe-framed thinking block is captured, answer lane stays clean', () => {
  const { visible, thinking } = run(
    'Here is the answer.\n| thinking|\nprivate working notes\n|/thinking|\nFinal line.',
  );
  assert.equal(visible, 'Here is the answer.\n\nFinal line.');
  assert.match(thinking, /private working notes/);
  assert.doesNotMatch(thinking, /Final line/);
});

test('soft-pipe frames (│) are normalised and captured the same way', () => {
  const { visible, thinking } = run(
    'Answer.\n│ thinking│\nsoft pipe reasoning\n│/thinking│\nDone.',
  );
  assert.equal(visible, 'Answer.\n\nDone.');
  assert.match(thinking, /soft pipe reasoning/);
});

test('bare  thinking …  response scratchpad is captured', () => {
  const { visible, thinking } = run(
    'Answer.\n thinking\nbare scratchpad reasoning\n response\nDone.',
  );
  assert.equal(visible, 'Answer.\n\nDone.');
  assert.match(thinking, /bare scratchpad reasoning/);
});

test('unclosed block at stream end flushes into thinking, not the answer', () => {
  const scrubber = new StreamingThinkScrubber();
  assert.equal(scrubber.push('Answer start.\n| thinking|\nstill working'), 'Answer start.\n');
  assert.equal(scrubber.finish(), '');
  assert.match(scrubber.drainThinking(), /still working/);
});

test('a block split across many chunks never leaks into the answer lane', () => {
  const scrubber = new StreamingThinkScrubber();
  const chunks = ['Answer.\n| thin', 'king|', 'co', 't', '|/think', 'ing|', '\nDone.'];
  let visible = '';
  for (const chunk of chunks) visible += scrubber.push(chunk);
  visible += scrubber.finish();
  assert.equal(visible, 'Answer.\n\nDone.');
  assert.match(scrubber.drainThinking(), /cot/);
});

test('classic XML CoT tags still captured (legacy)', () => {
  const { visible, thinking } = run(
    'Answer.\n<thinking>\nxml reasoning\n</thinking>\nDone.',
  );
  assert.equal(visible, 'Answer.\n\nDone.');
  assert.match(thinking, /xml reasoning/);
});

test('plain text passes through untouched with no thinking', () => {
  const { visible, thinking } = run('Just a plain answer, no reasoning.');
  assert.equal(visible, 'Just a plain answer, no reasoning.');
  assert.equal(thinking, '');
});
