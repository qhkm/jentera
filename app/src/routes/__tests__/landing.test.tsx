import { act, render, screen, waitFor, within } from "@testing-library/react";
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

  it("offers account creation and a clearly labelled local-business illustration", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "AI staff that works 24/7 for Malaysian businesses.",
    );
    for (const link of screen.getAllByRole("link", {
      name: /meet jentera|set up jentera/i,
    })) {
      expect(link).toHaveAttribute("href", "/signin?mode=signup");
    }
    expect(
      screen.getByText(
        /An illustration. Your work uses the details you confirm./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /try the setup without an account/i }),
    ).toHaveAttribute("href", "/onboard");
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
  /* The landing sits outside the repository gate on purpose (first paint
     must not wait on the API), so it asks /api/me itself, after paint, and
     sends an owner who is already signed in to the app. */
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
        </Routes>
      </MemoryRouter>,
    );
  }

  it("is sent to the app once the session check answers", async () => {
    const calls: string[] = [];
    mountAt(async (input) => {
      calls.push(String(input));
      return Response.json({ userId: "u1" });
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Workspace" })).toBeInTheDocument(),
    );
    expect(calls).toEqual(["https://api.test/api/me"]);
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
