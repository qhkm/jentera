/* DOM matchers for every test file: toBeDisabled, toHaveValue, and the
   rest. Registered globally so no test has to remember the import. */
import '@testing-library/jest-dom/vitest';

/* Testing Library keeps its own deadline, separate from Vitest's.

   `findBy*` and `waitFor` give up after one second by default, and that
   second is wall clock on a machine running every other test file at the
   same time — not work this app is doing. When it expired the failure
   read "Unable to find an element with the text …", which looks exactly
   like a render that is wrong rather than one that has not finished, and
   it landed on a different two or three tests every run.

   Five seconds is still short enough to catch an element that genuinely
   never appears; nothing here settles slowly when it is the only thing
   running (the same files pass in well under a second each on their own).
   Vitest's own per-test timeout is raised alongside it in
   `vitest.config.ts` — both had to move, since whichever is lower is the
   one that fires. */
import { configure } from '@testing-library/dom';

configure({ asyncUtilTimeout: 5_000 });
