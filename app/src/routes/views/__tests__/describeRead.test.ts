/* ============================================================
   Telling the owner what was actually read.

   jentera.ai returns a 727-byte SPA shell. Strip the scripts and 43
   characters remain — the <title>. AISAR extracted the one fact that
   text contains, correctly invented nothing else, and reported "AISAR
   found 1 thing", which reads as "I read your site".

   It had not. It read a title tag. The extraction was never the
   problem; reporting a successful read of a page it could not see was.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { describeRead } from '@/routes/views/KnowledgePanel';

describe('a page that needs JavaScript', () => {
  it('says so instead of claiming a successful read', () => {
    /* The real numbers from jentera.ai. */
    const note = describeRead({ facts: 1, chars: 43 });
    expect(note).toMatch(/needs JavaScript/i);
    expect(note).toContain('43 characters');
    expect(note).not.toMatch(/AISAR found 1 thing\./);
  });

  it('does not credit the title with being the site', () => {
    expect(describeRead({ facts: 1, chars: 43 })).toMatch(/from the title alone/i);
  });

  it('is still honest when a shell yields nothing at all', () => {
    expect(describeRead({ facts: 0, chars: 12 })).toMatch(/nothing to suggest/i);
  });
});

describe('a page AISAR could actually read', () => {
  it('reports what it found', () => {
    const note = describeRead({ facts: 3, chars: 5000 });
    expect(note).toMatch(/found 3 things/i);
    expect(note).not.toMatch(/JavaScript/i);
  });

  it('says so when a readable page had nothing worth suggesting', () => {
    const note = describeRead({ facts: 0, chars: 5000 });
    expect(note).toMatch(/nothing clear enough/i);
    expect(note).not.toMatch(/JavaScript/i);
  });

  it('gets the singular right', () => {
    expect(describeRead({ facts: 1, chars: 5000 })).toMatch(/found 1 thing\./);
  });
});
