/* ============================================================
   The fabricated inbox, and who is allowed to see it.

   `useChat` seeds each agent thread with hand-written conversations:
   named customers, invented messages, timestamps. For the anonymous
   demo that is the entire point — it is showing what the product does.
   For a signed-in owner it was the sharpest-edged version of the lie
   this app kept telling: not a wrong number, but a person. Farid
   booking a table for two on Saturday does not exist, and the screen
   offered a reply box pointed at him.

   Real customer messages arrive through a connected channel and are
   recorded as runs, which is why the signed-in state points at
   Activity rather than inventing an inbox that does not exist yet.
   ============================================================ */

import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerInbox from '@/routes/views/CustomerInbox';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { resolveBusiness } from '@/lib/business';

/** Names the seeds invent. None of them is a customer of anyone. */
const INVENTED = [/Aisyah/, /Farid/, /Siti/];

/** A real snapshot: resolveBusiness reads more of it than a stub has. */
async function mount(signedIn: boolean) {
  localStorage.setItem('aisar-biz-type', 'restaurant');
  const repo = new LocalRepository();
  const business = resolveBusiness(await repo.load(), 'restaurant');
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <CustomerInbox business={business} />
        </I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

/* jsdom implements no scrollTo on elements, and the thread scrolls
   itself to the bottom on open. A gap in the environment, not the
   component. */
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

beforeEach(() => localStorage.clear());

/* Every negative assertion below is preceded by a positive one. The
   provider loads its snapshot asynchronously, so an unanchored
   `queryBy(...).toBeNull()` passes against an empty container — which
   is exactly what the first draft of this file did, three times. */

describe('a signed-in owner', () => {
  it('is told where their real conversations are, and shown no invented customers', async () => {
    await mount(true);
    expect(await screen.findByText(/no customer conversations yet/i)).toBeInTheDocument();
    expect(screen.getByText(/appear under Activity/i)).toBeInTheDocument();

    for (const name of INVENTED) {
      expect(screen.queryByText(name), `${name} is not anyone's customer`).toBeNull();
    }
  });

  it('gets no reply box pointed at a person who does not exist', async () => {
    /* The reply box is the part that makes this worse than a wrong
       counter: it invites an answer that goes nowhere. */
    await mount(true);
    await screen.findByText(/no customer conversations yet/i);

    expect(screen.queryByPlaceholderText(/type a reply|take over/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull();
  });
});

describe('the anonymous demo', () => {
  it('keeps its conversations', async () => {
    /* The demo's job is to show what the product looks like working,
       and gutting it would cost the thing the fix was protecting. */
    await mount(false);
    expect(await screen.findByPlaceholderText(/search conversations/i)).toBeInTheDocument();
    expect(screen.queryByText(/no customer conversations yet/i)).toBeNull();
  });

  it('still reaches a thread with its invented customers in it', async () => {
    await mount(false);
    const thread = await screen.findByRole('button', { name: /Customer Assistant/i });
    await userEvent.click(thread);
    /* She appears on both her messages; one is enough to prove the
       demo still has its threads. */
    expect((await screen.findAllByText(/Aisyah/)).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/type a reply|take over/i)).toBeInTheDocument();
  });
});
