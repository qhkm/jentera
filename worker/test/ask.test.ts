/* ============================================================
   Answering from what is known.

   One property here matters more than the rest: an unconfirmed fact
   must never reach the model. Unconfirmed means a guess nobody has
   vouched for, and letting guesses answer questions would make the
   whole review step decorative — the owner would be confirming facts
   that were already being told to customers.

   Everything else in this file is ordinary. That one is the reason it
   exists.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, asTenant, truncateAll } from './harness';
import { answer, prepareHermesAgent, retrieve } from '../src/ask';
import { recordFact } from '../src/facts';
import type { Env } from '../src/env';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let userId: string;

/** Captures what the model was actually shown. */
function spyModel(response = 'An answer.') {
  const seen: string[] = [];
  const env = {
    AI: {
      run: async (_m: string, opts: { messages: { role: string; content: string }[] }) => {
        seen.push(opts.messages.map((m) => m.content).join('\n'));
        return { response };
      },
    },
  } as unknown as Env;
  return { env, seen };
}

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    const [u] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    userId = u.id;
  });
});

/** An owner-stated fact is confirmed; an agent guess is not. */
const stated = (key: string, value: unknown) =>
  asTenant(A, (tx) => recordFact(tx, A, { key, value, source: 'owner', confirmedBy: userId }));
const guessed = (key: string, value: unknown, confidence = 0.6) =>
  asTenant(A, (tx) => recordFact(tx, A, { key, value, source: 'agent', confidence }));

describe('what reaches the model', () => {
  it('never includes an unconfirmed guess', async () => {
    /* The property the review step depends on. If this breaks, Jentera
       tells customers things nobody approved, and the "needs your eye"
       queue becomes theatre. */
    await guessed('service.consult.price', 'RM150');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'how much is a consult?'));
    expect(facts).toHaveLength(0);
  });

  it('includes it the moment it is confirmed', async () => {
    await guessed('service.consult.price', 'RM150');
    await asTenant(A, (tx) => tx`
      update business_fact set confirmed_by = ${userId}, confirmed_at = now() where live`);
    const facts = await asTenant(A, (tx) => retrieve(tx, 'how much is a consult?'));
    expect(facts.map((f) => f.key)).toEqual(['service.consult.price']);
  });

  it('ignores a superseded version', async () => {
    await stated('hours.monday', '9-5');
    await stated('hours.monday', '11-8');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'monday hours'));
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('11-8');
  });

  it('ignores a forgotten fact', async () => {
    await stated('hours.monday', '9-5');
    await asTenant(A, (tx) => tx`update business_fact set live = false where live`);
    expect(await asTenant(A, (tx) => retrieve(tx, 'monday hours'))).toHaveLength(0);
  });

  it('never includes another business’s facts', async () => {
    await asTenant(B, (tx) =>
      recordFact(tx, B, { key: 'secret.recipe', value: 'nasi', source: 'owner', confirmedBy: userId }),
    );
    expect(await asTenant(A, (tx) => retrieve(tx, 'recipe'))).toHaveLength(0);
  });
});

describe('choosing which facts to show', () => {
  it('prefers the ones the question mentions', async () => {
    await stated('hours.monday', '9am to 6pm');
    await stated('payment.methods', 'cash and card');
    await stated('business.address', 'Jalan Ampang');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'what are your monday hours?'));
    expect(facts[0].key).toBe('hours.monday');
  });

  it('matches on the value, not only the key', async () => {
    await stated('business.about', 'We serve nasi lemak all day');
    await stated('hours.monday', '9-6');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'do you have nasi lemak?'));
    expect(facts[0].key).toBe('business.about');
  });

  it('falls back to everything when nothing matches the wording', async () => {
    /* Refusing to answer because the question was phrased differently
       would be a retrieval bug presenting itself as ignorance. */
    await stated('hours.monday', '9am to 6pm');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'bilakah anda buka?'));
    expect(facts).toHaveLength(1);
  });

  it('is bounded', async () => {
    for (let i = 0; i < 40; i++) await stated(`k${i}.v`, `value ${i}`);
    expect((await asTenant(A, (tx) => retrieve(tx, 'anything'))).length).toBeLessThanOrEqual(24);
  });
});

describe('the answer', () => {
  it('reports grounded=false with nothing to reason from', async () => {
    const { env } = spyModel("I don't know that yet.");
    const out = await answer(env, 'are you open?', [], []);
    expect(out.grounded).toBe(false);
    expect(out.usedKeys).toEqual([]);
  });

  it('reports what it used, so a wrong answer is traceable', async () => {
    await stated('hours.monday', '9am to 6pm');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'monday hours'));
    const { env } = spyModel('We open 9am Monday.');
    const out = await answer(env, 'monday hours', facts, []);
    expect(out.grounded).toBe(true);
    expect(out.usedKeys).toEqual(['hours.monday']);
  });

  it('shows the model the facts and the recent work', async () => {
    await stated('hours.monday', '9am to 6pm');
    const facts = await asTenant(A, (tx) => retrieve(tx, 'hours'));
    const { env, seen } = spyModel();
    await answer(env, 'when do you open?', facts, [
      { objective: 'Replied to Aminah', outcome: 'sent', occurredAt: new Date() },
    ]);
    expect(seen[0]).toContain('hours.monday');
    expect(seen[0]).toContain('9am to 6pm');
    expect(seen[0]).toContain('Replied to Aminah');
    expect(seen[0]).toContain('when do you open?');
  });

  it('tells the model not to invent, in the prompt itself', async () => {
    const { env, seen } = spyModel();
    await answer(env, 'do you deliver?', [], []);
    /* Not a style check. The instruction is the only thing standing
       between "I don't know" and a confidently invented delivery
       charge quoted to a customer. */
    expect(seen[0]).toMatch(/do not (guess|invent)|never invent/i);
    expect(seen[0]).toContain('(nothing confirmed yet)');
  });

  it('degrades to a sentence rather than throwing when the model misbehaves', async () => {
    for (const bad of [{}, { response: 42 }, { response: null }]) {
      const env = { AI: { run: async () => bad } } as unknown as Env;
      const out = await answer(env, 'anything?', [], []);
      expect(typeof out.text).toBe('string');
      expect(out.text.length).toBeGreaterThan(0);
    }
  });
});

describe('the durable Hermes agent request', () => {
  it('acts as a private agent for the owner rather than a customer-facing bot', () => {
    const prepared = prepareHermesAgent(
      'help me plan the week',
      [],
      [],
      new Date('2026-08-28T05:00:00.000Z'),
    );

    expect(prepared.instructions).toMatch(/private internal business agent/i);
    expect(prepared.instructions).toMatch(/owner and their team/i);
    expect(prepared.instructions).toMatch(/never as one of the business's customers/i);
    expect(prepared.instructions).toMatch(/do not behave as a public customer-support bot/i);
  });

  it('requires live research for current questions and keeps source links in the answer', () => {
    const prepared = prepareHermesAgent(
      "what's latest today in tech?",
      [],
      [],
      new Date('2026-08-28T05:00:00.000Z'),
    );

    expect(prepared.instructions).toContain('Current date (UTC): 2026-08-28');
    expect(prepared.instructions).toMatch(/research it now/i);
    expect(prepared.instructions).toMatch(/briefly narrate what you are checking/i);
    expect(prepared.instructions).toMatch(/primary or authoritative sources/i);
    expect(prepared.instructions).toMatch(/not hidden chain-of-thought/i);
    expect(prepared.instructions).toMatch(/discovery snippets, not sufficient evidence/i);
    expect(prepared.instructions).toMatch(/fall back to browser navigation or curl/i);
    expect(prepared.instructions).toMatch(/Never return a long uninterrupted block/i);
    expect(prepared.instructions).toMatch(/short descriptive\s+section headings/i);
    expect(prepared.instructions).toMatch(/hyphen bullets/i);
    expect(prepared.instructions).toMatch(/final\s+Sources section/i);
    expect(prepared.instructions).toMatch(/Markdown links/i);
    expect(prepared.instructions).toMatch(/execute code|inspect files|use the browser/i);
    expect(prepared.input).toContain("User request: what's latest today in tech?");
  });

  it('carries confirmed business context without restricting the agent to it', () => {
    const prepared = prepareHermesAgent(
      'compare our opening hours with the event schedule online',
      [{
        key: 'hours.monday',
        value: '9am to 6pm',
        source: 'owner',
        sourceRef: null,
        confidence: 1,
        confirmed: true,
      }],
      [{ objective: 'Published the new menu', outcome: 'done' }],
      new Date('2026-08-28T05:00:00.000Z'),
    );

    expect(prepared.input).toContain('hours.monday: 9am to 6pm');
    expect(prepared.input).toContain('Published the new menu — done');
    expect(prepared.usedKeys).toEqual(['hours.monday']);
    expect(prepared.grounded).toBe(true);
    expect(prepared.instructions).toMatch(/External\s+research supplements it/i);
  });
});

/* ============================================================
   Provenance.

   `source_ref` exists so a claim is checkable — the schema says as
   much. It was selected out of the database and then dropped before
   the model ever saw it, so when an owner asked where a fact came
   from, the model had nothing to answer with and invented something:
   "I learned that from our recent interactions" about a fact read off
   a web page.

   A confabulated citation is worse than no citation on a screen whose
   promise is that you can check what Jentera knows and where it came
   from. Found on production, not by a test.
   ============================================================ */

/** An agent-read fact, confirmed by the owner, carrying its source. */
const readFromWeb = (key: string, value: unknown, url: string) =>
  asTenant(A, (tx) =>
    recordFact(tx, A, {
      key,
      value,
      source: 'agent',
      sourceRef: url,
      confidence: 0.9,
      confirmedBy: userId,
    }),
  );

describe('where a fact came from', () => {
  it('survives retrieval instead of being dropped', async () => {
    await readFromWeb('business.name', 'Jentera', 'https://jentera.ai');
    const [fact] = await asTenant(A, (tx) => retrieve(tx, 'what is my business called'));
    expect(fact.sourceRef).toBe('https://jentera.ai');
  });

  it('reaches the model with the fact it belongs to', async () => {
    /* The bug. The model was shown "business.name: Jentera" and nothing
       else, then asked where that came from. */
    await readFromWeb('business.name', 'Jentera', 'https://jentera.ai');
    const { env, seen } = spyModel();
    const facts = await asTenant(A, (tx) => retrieve(tx, 'where did you learn my name'));

    await answer(env, 'where did you learn my name', facts, []);

    expect(seen[0]).toContain('https://jentera.ai');
    expect(seen[0]).toMatch(/business\.name: Jentera \[read from https:\/\/jentera\.ai\]/);
  });

  it('says the owner told it, when the owner did', async () => {
    /* `source_ref` is null for an owner-stated fact by design — the
       source is the person. That must not render as a missing source. */
    await stated('hours.monday', '9am - 6pm');
    const { env, seen } = spyModel();
    const facts = await asTenant(A, (tx) => retrieve(tx, 'what are my monday hours'));

    await answer(env, 'what are my monday hours', facts, []);

    expect(seen[0]).toContain('[you told me this]');
    expect(seen[0]).not.toContain('no source recorded');
  });

  it('is honest when a source is genuinely missing', async () => {
    await asTenant(A, (tx) =>
      recordFact(tx, A, {
        key: 'menu.vegetarian',
        value: 'yes',
        source: 'connector',
        confidence: 0.8,
        confirmedBy: userId,
      }),
    );
    const { env, seen } = spyModel();
    const facts = await asTenant(A, (tx) => retrieve(tx, 'vegetarian'));

    await answer(env, 'vegetarian', facts, []);
    expect(seen[0]).toContain('no source recorded');
  });

  it('tells the model not to invent one', async () => {
    /* The prompt is half the fix. Without a source the model still had
       to say something, and the standing instruction to never sound
       like a machine pushed it toward inventing a plausible history. */
    await readFromWeb('business.name', 'Jentera', 'https://jentera.ai');
    const { env, seen } = spyModel();
    const facts = await asTenant(A, (tx) => retrieve(tx, 'name'));

    await answer(env, 'name', facts, []);
    expect(seen[0]).toMatch(/never invent a source/i);
  });
});

describe('the bracket is a note to the model, not to the reader', () => {
  it('is told not to copy it into the answer', async () => {
    /* The first version of this prompt said "repeat what the brackets
       say", and the model duly pasted "[https://jentera.ai]" into
       ordinary answers where nobody had asked about provenance. The
       same function drafts replies to real customers, so a customer
       would have received the bracket too. */
    await readFromWeb('business.name', 'Jentera', 'https://jentera.ai');
    const { env, seen } = spyModel();
    const facts = await asTenant(A, (tx) => retrieve(tx, 'how are you'));

    await answer(env, 'how are you', facts, []);

    /* The prompt hard-wraps, so these must tolerate a newline and
       indent falling anywhere inside the phrase. */
    expect(seen[0]).toMatch(/never\s+copy\s+a\s+bracket/i);
    expect(seen[0]).toMatch(/only\s+say\s+where\s+something\s+came\s+from\s+if\s+you\s+are\s+asked/i);
  });

  it('still carries the source for when it is asked', async () => {
    await readFromWeb('business.name', 'Jentera', 'https://jentera.ai');
    const { env, seen } = spyModel();
    const facts = await asTenant(A, (tx) => retrieve(tx, 'where'));

    await answer(env, 'where', facts, []);
    expect(seen[0]).toContain('[read from https://jentera.ai]');
  });
});
