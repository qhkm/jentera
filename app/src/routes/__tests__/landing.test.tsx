import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Landing from "@/routes/Landing";
import { BUSINESS_EXAMPLES } from "@/lib/landing-content";

function mount() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe("Jentera landing experience", () => {
  it("presents launch pricing without implying a paid reservation or lifetime rate", () => {
    mount();
    const pricing = screen.getByRole("region", { name: /your ai staff.*special launch price/i });
    expect(within(pricing).getByText("RM99")).toBeVisible();
    expect(within(pricing).getByText("/month")).toBeVisible();
    expect(pricing).not.toHaveTextContent("One computer task at a time");
    expect(within(pricing).getByRole("link", { name: 'Get My AI Staff — RM99' })).toHaveAttribute("href", "/signin");
    expect(pricing).not.toHaveTextContent("no payment today");
    expect(pricing).toHaveTextContent("Early-user launch offer");
    expect(pricing).not.toHaveTextContent("Purchases are not open yet.");
    expect(pricing).not.toHaveTextContent("Launching on");
    expect(within(pricing).getAllByRole('link')).toHaveLength(1);
    expect(pricing).toHaveTextContent("Review usage limits and cancellation terms before subscribing.");
    expect(pricing).toHaveTextContent("first 3 monthly billing periods, then RM199/month from month 4");
    expect(pricing).toHaveTextContent('Private WhatsApp support group');
    expect(pricing).toHaveTextContent('Direct access to the founder');
    expect(pricing).toHaveTextContent('Save RM300 over your first 3 months');
    expect(pricing).not.toHaveTextContent('Free Automation Mapping');
    expect(pricing).not.toHaveTextContent('Lucky draw');
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/#pricing");
  });

  it("invites a phone visitor to install once the page has settled", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("navigator", {
        ...navigator,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
      });
      mount();
      expect(screen.queryByRole("region", { name: /get jentera on your phone/i })).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(6_500); });
      expect(screen.getByRole("region", { name: /get jentera on your phone/i })).toHaveTextContent(/Add to Home Screen/);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("uses one consistent launch action and a clearly labelled local-business illustration", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "AI staff that works 24/7 for 🇲🇾 Malaysian businesses.",
    );
    const proof = screen.getByRole("region", {
      name: /you stay in control.*important actions/i,
    });
    expect(within(proof).getByText("Confirmed business knowledge")).toBeVisible();
    expect(within(proof).getByText("Approval when it matters")).toBeVisible();
    expect(within(proof).getByText("A clear activity history")).toBeVisible();
    expect(within(proof).getByRole('img')).toHaveAttribute('src', '/images/product-tour/knowledge-mobile-v1.png');
    for (const link of screen.getAllByRole("link", {
      name: 'Get My AI Staff — RM99',
    })) {
      expect(link).toHaveAttribute("href", "/signin");
    }
    expect(
      screen.getByText(
        /An illustration. Your work uses the details you confirm./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /see supported connections/i }),
    ).toHaveAttribute("href", "/connect");
  });
  it('restores the original hero presentation and removes outdated purchase notices', () => {
    const { container } = mount();
    const hero = container.querySelector('.lp-hero-copy');
    expect(hero?.querySelector('.hero-hours')).toHaveTextContent('24/7');
    expect(hero?.querySelector('.hero-country')).toHaveTextContent('Malaysian');
    expect(hero).toHaveTextContent('Just hand the work to Jentera.');
    expect(hero).toHaveTextContent('your AI staff has its own computer');
    expect(hero).toHaveTextContent('Try 10 chats free.');
    expect(hero).toHaveTextContent('RM99/month for your first 3 months, RM199/month thereafter.');
    expect(hero?.querySelector('.lp-hero-benefits')).toBeNull();
    expect(within(hero as HTMLElement).getByRole('link', { name: 'Try my AI staff — 10 free chats' })).toHaveAttribute('href', '/signin');
    for (const notice of ['Purchases are not open yet', 'no payment today', 'will be published before checkout opens']) {
      expect(container).not.toHaveTextContent(notice);
    }
  });

  it('moves from demonstration to mechanism, jobs, control and pricing without duplicate positioning sections', () => {
    const { container } = mount();
    const ids = [...container.querySelectorAll('main > section[id]')].map(section => section.id);
    expect(ids).toEqual(['first-workflow', 'product-tour', 'how', 'work', 'control', 'pricing', 'questions']);
    expect(container.querySelector('.lp-workflow-examples')?.children).toHaveLength(5);
    expect(container.querySelector('#first-workflow')).toHaveTextContent('You don’t need to build complicated workflows');
    expect(container.querySelector('#first-workflow')).toHaveTextContent('Start with one task');
    expect(container.querySelector('#first-workflow')).toHaveTextContent('limited pilot');
    expect(container.querySelector('.lp-job-grid')?.children).toHaveLength(8);
    for (const title of ['Keep enquiries moving.', 'Get next week’s content ready.', 'Move from enquiry to quotation.', 'Find your next opportunities.', 'Turn the numbers into a report.']) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    }
    expect(container.querySelector('#work')).toHaveTextContent('not one-click integrations');
    expect(container.querySelector('#work')).toHaveTextContent('Review customer-facing messages and financial documents before sending.');
    expect(screen.getByRole('heading', { name: /give it a job.*not another prompt/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Watch supplier prices.' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Plan your next week of content.' })).not.toBeInTheDocument();
    expect(container.querySelector('.lp-trades-section')).toBeNull();
    expect(container.querySelector('.lp-local-section')).toBeNull();
    expect(container.querySelector('#aisar')).toBeNull();
  });

  it('explains the dedicated computer through practical tasks and supported access', () => {
    mount();
    const section = screen.getByRole('region', { name: /AI staff.*its own computer/i });
    expect(section).toHaveTextContent('no technical setup to figure out.');
    expect(section).toHaveTextContent('Less prompting. More delegating.');
    expect(section).toHaveTextContent('Hand off the work. Come back to the result.');
    expect(section).not.toHaveTextContent('activation goal');
    expect(section).not.toHaveTextContent('24–48 hours');
    expect(within(section).getAllByRole('article')).toHaveLength(4);
    expect(section).toHaveTextContent('You don’t need to keep your laptop open.');
    expect(section).toHaveTextContent('supported websites and connections');
    expect(section).toHaveTextContent('not every website allows automated access');
    expect(section).toHaveTextContent('Upload a picture, document or spreadsheet.');
    expect(section).toHaveTextContent('what a good result looks like');
  });

  it('thanks paid early users without exposing the founder-group invitation publicly', () => {
    const { container } = mount();
    const pricing = screen.getByRole('region', { name: /your ai staff.*special launch price/i });
    expect(pricing).toHaveTextContent('As a thank-you for supporting us early');
    expect(pricing).toHaveTextContent('direct founder access');
    expect(pricing).toHaveTextContent('help shape what we build next');
    expect(pricing).toHaveTextContent('after payment is confirmed');
    expect(pricing).not.toHaveTextContent('Free Automation Mapping');
    expect(container.innerHTML).not.toContain('chat.whatsapp.com');
    expect(container.querySelectorAll('a[href*="whatsapp"]')).toHaveLength(0);
  });

  it('states launch limits instead of promising unlimited AI or universal routine access', async () => {
    const user = userEvent.setup();
    mount();
    const pricing = screen.getByRole('region', { name: /your ai staff.*special launch price/i });
    expect(pricing).toHaveTextContent('Standard AI usage included; fair-use limits apply.');
    expect(pricing).not.toHaveTextContent('Unlimited AI');
    await user.click(screen.getByText('Is AI usage unlimited?'));
    const usage = screen.getByText('Is AI usage unlimited?').closest('details');
    expect(usage).toHaveTextContent('No.');
    expect(usage).toHaveTextContent('does not promise unlimited usage');
    await user.click(screen.getByText('Can Jentera run work on a schedule?'));
    const routines = screen.getByText('Can Jentera run work on a schedule?').closest('details');
    expect(routines).toHaveTextContent('limited pilot');
    expect(routines).toHaveTextContent('not enabled for every account');
  });

  it('keeps customer benefits separate from computer limits and safety features', async () => {
    const user = userEvent.setup();
    const { container } = mount();
    const benefits = screen.getByRole('list', { name: 'Launch plan inclusions' });
    expect(within(benefits).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Your own AI staff, available 24/7',
      'Its own dedicated computer',
      'AI usage included for day-to-day work',
      'Private WhatsApp support group',
      'Direct access to the founder',
      'Early access to new features',
    ]);
    for (const removed of ['Automation Mapping', 'Help choosing and setting up', 'One computer task', 'Approvals and activity history']) {
      expect(benefits).not.toHaveTextContent(removed);
    }
    expect(container).not.toHaveTextContent('Automation Mapping');
    expect(container).not.toHaveTextContent('RM900');
    await user.click(screen.getByText('How many computer tasks can run at once?'));
    expect(screen.getByText('How many computer tasks can run at once?').closest('details')).toHaveTextContent('Your AI staff handles one computer task at a time.');
    expect(screen.getByRole('region', { name: /you stay in control.*important actions/i })).toHaveTextContent('A clear activity history');
  });

  it('offers concrete file and draft jobs without advertising unavailable inbox or publishing integrations', () => {
    const { container } = mount();
    const jobs = container.querySelector('#work');
    expect(jobs).toHaveTextContent('Upload your order files or spreadsheet.');
    expect(jobs).toHaveTextContent('follow-up messages for your review');
    expect(jobs).toHaveTextContent('Review and publish them through your own channels.');
    for (const claim of ['connected inbox', 'connected mailbox', 'schedule publishing through supported connections']) {
      expect(jobs).not.toHaveTextContent(claim);
    }
    expect(screen.getByRole('heading', { name: /what are you still doing manually.*hand it to jentera/i })).toBeVisible();
  });

  it("switches examples and restores keyboard focus when returning from a draft", async () => {
    const user = userEvent.setup();
    mount();
    const openDraft = () =>
      screen.getByRole("button", { name: /see an example draft/i });
    await user.click(openDraft());
    expect(
      screen.getByRole("heading", { name: BUSINESS_EXAMPLES[0].draftTitle }),
    ).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: /back to the example/i }),
    );
    expect(openDraft()).toHaveFocus();
    await user.click(openDraft());
    await user.click(screen.getByRole("tab", { name: "Catering" }));
    const panel = screen.getByRole("tabpanel", { name: "Catering" });
    expect(
      within(panel).getByText(BUSINESS_EXAMPLES[2].request),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(BUSINESS_EXAMPLES[0].draft),
    ).not.toBeInTheDocument();
    expect(openDraft()).toBeInTheDocument();
  });

  it("supports arrow keys, Home, and End for business tabs", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("tab", { name: "Kopitiam" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Klinik" })).toHaveFocus();
    expect(
      screen.getByRole("tabpanel", { name: "Klinik" }),
    ).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Kedai" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Kopitiam" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Kedai" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Kopitiam" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const tab of screen.getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBe(
        screen.getByRole("tabpanel"),
      );
    }
  });

  it("closes mobile navigation on Escape and returns focus to its toggle", async () => {
    const user = userEvent.setup();
    mount();
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
    within(nav).getByRole("link", { name: "Sign in" }).focus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });
});

describe("a signed-in visitor on the landing page", () => {
  /* Deliberately public, including for active and exhausted-preview owners.
     The sign-in route still chooses the authenticated destination. */
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mountAt(fetchFake: typeof fetch) {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubGlobal("fetch", fetchFake);
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<h1>Workspace</h1>} />
          <Route path="/access" element={<h1>Choose your plan</h1>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("stays browsable for an active owner without an automatic workspace redirect", async () => {
    const calls: string[] = [];
    mountAt(async (input) => {
      calls.push(String(input));
      return Response.json({ userId: "u1" });
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AI staff that works 24/7");
    expect(screen.queryByRole("heading", { name: "Workspace" })).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('lets an unpaid signed-in owner browse the public site instead of returning to the paywall', async () => {
    await act(async () => {
      mountAt(async () => Response.json({ code: 'ACCESS_REQUIRED' }, { status: 403 }));
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI staff that works 24/7');
    expect(screen.queryByRole('heading', { name: 'Choose your plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  it("stays on the landing page when signed out or when the API is unreachable", async () => {
    mountAt(async () => new Response("", { status: 401 }));
    await screen.findByRole("heading", { level: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("heading", { name: "Workspace" })).toBeNull();

    vi.unstubAllGlobals();
    mountAt(async () => { throw new TypeError("Failed to fetch"); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("heading", { name: "Workspace" })).toBeNull();
  });
});
