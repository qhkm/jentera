/* ============================================================
   One database for the whole run.

   Each test file used to start and stop its own container. Sequential
   or not, Docker does not release a published port the instant the
   container dies, so the next `docker run` intermittently lost the
   race and a whole file's tests were skipped — a suite that is green
   four times out of five is worse than no suite, because it teaches
   you to re-run instead of to read.
   ============================================================ */

import { startDatabase, stopDatabase } from './harness';

export async function setup() {
  await startDatabase();
}

export async function teardown() {
  stopDatabase();
}
