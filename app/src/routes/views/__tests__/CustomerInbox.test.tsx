/* ============================================================
   The dormant customer inbox.

   `useChat` seeds each agent thread with hand-written conversations:
   named customers, invented messages, timestamps. For the anonymous
   demo that is the entire point — it is showing what the product does.
   A role must not enter the active business model until customer-facing
   execution exists and the owner connects a supported customer channel.

   Real customer messages arrive through a connected channel and are
   recorded as runs, which is why the signed-in state points at
   Activity rather than inventing an inbox that does not exist yet.
   ============================================================ */

import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('does not claim customer-facing capability that the product lacks', async () => {
    await mount(false);
    expect(await screen.findByText(/no conversations match/i)).toBeInTheDocument();
    for (const name of INVENTED) expect(screen.queryByText(name)).toBeNull();
  });
});
