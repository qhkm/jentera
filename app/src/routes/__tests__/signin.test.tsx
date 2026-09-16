import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignIn from '@/routes/SignIn';

vi.mock('@/lib/analytics', () => ({ trackActivation: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

function mount(path = '/signin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SignIn />
    </MemoryRouter>,
  );
}

describe('sign-in experience', () => {
  /* The page must never mint a native code just because a URL said so.
     A link carrying someone else's state and PKCE challenge, opened by a
     signed-in owner, used to hand a 7-day credential for their account to
     whatever app claims the ai.jentera.app scheme. The mint now waits for a
     deliberate tap, and this test is what keeps it waiting. */
  it('does not hand the session to the app until someone asks it to', async () => {
    const state = 'state-0123456789abcdef';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, code: 'minted' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount(`/signin?native=1&state=${state}&code_challenge=${challenge}`);

    const minted = () => request.mock.calls.some(([input]) =>
      String(typeof input === 'string' ? input : (input as Request).url).includes('/api/auth/native/code'));

    await waitFor(() => expect(screen.getByRole('button', { name: /return to the jentera app/i })).toBeTruthy());
    expect(minted()).toBe(false);

    /* The tap runs the handoff. It cannot complete here — handoffBrowserSession
       returns early without VITE_API_URL — so the observable proof that the tap
       (and only the tap) drives it is the failure it reports. */
    await user.click(screen.getByRole('button', { name: /return to the jentera app/i }));
    await waitFor(() => expect(
      screen.getByText(/could not be returned to the jentera app/i),
    ).toBeTruthy());
  });

  it('carries the native state and PKCE challenge through every sign-in door', async () => {
    const state = 'state-0123456789abcdef';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount(`/signin?native=1&state=${state}&code_challenge=${challenge}`);

    const googleForm = screen.getByRole('button', { name: /continue with google/i }).closest('form')!;
    const googleData = new FormData(googleForm);
    expect(googleData.get('native')).toBe('1');
    expect(googleData.get('state')).toBe(state);
    expect(googleData.get('codeChallenge')).toBe(challenge);

    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    const body = JSON.parse(String((request.mock.calls.at(-1)?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      native: true,
      state,
      codeChallenge: challenge,
    });
  });

  it('shows only the system-browser door inside a native shell', () => {
    vi.stubGlobal('Capacitor', {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    });
    mount();
    expect(screen.getByRole('button', { name: 'Continue to sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByText(/stored securely on this device/i)).toBeInTheDocument();
  });

  it('posts the invitation to Google sign-in without putting it in a query string or localStorage', async () => {
    const code = 'a'.repeat(48);
    window.history.replaceState(null, '', `/signin#code=${code}`);
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Your exclusive invitation will continue');
    const submit = screen.getByRole('button', { name: /continue with google/i });
    const form = submit.closest('form')!;
    expect(form.method).toBe('post');
    expect(form.action).toMatch(/\/api\/auth\/google$/);
    expect(new FormData(form).get('inviteCode')).toBe(code);
    expect(localStorage.getItem('jentera.pending-trial-invite.v1')).toBeNull();
  });
  it('includes the invitation when requesting an email sign-in link', async () => {
    const code = 'b'.repeat(48);
    window.history.replaceState(null, '', `/signin#code=${code}`);
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ inviteCode: code });
  });
  it('labels fields and lets an owner inspect their password', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('keeps account mode in sync with navigation', async () => {
    const user = userEvent.setup();
    mount('/signin?mode=signup');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create your account');
    expect(screen.queryByRole('button', { name: /email me a link/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back.');
    await user.click(screen.getByRole('button', { name: 'Create one' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create your account');
  });

  it('does not request a link for an invalid address', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Check your inbox' })).not.toBeInTheDocument();
  });

  it.each([429, 500, 'offline'] as const)(
    'shows a retryable error, not success, on %s',
    async (failure) => {
      const request =
        failure === 'offline'
          ? vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
          : vi.fn().mockResolvedValue(new Response(null, { status: failure }));
      vi.stubGlobal('fetch', request);
      const user = userEvent.setup();
      mount();
      await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
      await user.click(screen.getByRole('button', { name: /email me a link/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        failure === 429 ? /too many attempts/i : /could not/i,
      );
      expect(screen.queryByRole('heading', { name: 'Check your inbox' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /email me a link/i })).toBeEnabled();
    },
  );

  /* The confirmation for deletion is a typed address rather than a password
     precisely because magic-link and Google accounts have no password — so
     those two doors are the ones that must say an account is being deleted.
     Both used to drop the message: the link door rendered "could not send",
     the Google door rendered nothing at all. One test per door, asserting
     what the page shows rather than what the API answered. */
  it('names the cancel path when the link door refuses a deleting account', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json(
        {
          ok: false,
          err: 'An account for this address is being deleted. Use the cancel link in the email we sent to keep it.',
          code: 'ACCOUNT_DELETING',
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/being deleted/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancel link/i);
    expect(screen.queryByRole('heading', { name: 'Check your inbox' })).not.toBeInTheDocument();
  });

  it.each(['signin', 'signup'] as const)(
    'names the cancel path when the password %s door refuses a deleting account',
    async (mode) => {
      const request = vi.fn().mockResolvedValue(
        Response.json(
          {
            ok: false,
            err: 'An account for this address is being deleted. Use the cancel link in the email we sent to keep it.',
            code: 'ACCOUNT_DELETING',
          },
          { status: 409 },
        ),
      );
      vi.stubGlobal('fetch', request);
      const user = userEvent.setup();
      mount(mode === 'signup' ? '/signin?mode=signup' : '/signin');
      await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
      await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
      await user.click(
        screen.getByRole('button', { name: mode === 'signup' ? 'Create account' : 'Sign in' }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(/being deleted/i);
    },
  );

  it('names the cancel path when Google bounces a deleting account back', () => {
    mount('/signin?error=account-deleting');
    expect(screen.getByRole('alert')).toHaveTextContent(/being deleted/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/cancel link/i);
  });

  it('says so when a cancel link could not be honoured', () => {
    mount('/signin?error=restore-failed');
    expect(screen.getByRole('alert')).toHaveTextContent(/cancel link/i);
  });

  it('confirms a cancelled deletion when the restore link lands here', () => {
    mount('/signin?restored=1');
    expect(screen.getByRole('status')).toHaveTextContent(/no longer being deleted/i);
  });

  it('confirms a successful request without exposing account existence and allows correction', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'If owner@example.com has a Jentera account',
    );
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/request'),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'owner@example.com' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(screen.getByLabelText('Email address')).toHaveValue('owner@example.com');
  });
});

describe('a signed-in visitor on the sign-in page', () => {
  /* Same rule as the landing page: an owner who is already signed in is
     sent to the app once /api/me answers; a 401 leaves the form alone so a
     magic link or a fresh sign-in still works. */
  afterEach(() => vi.unstubAllEnvs());

  function mountAt(fetchFake: typeof fetch) {
    vi.stubEnv('VITE_API_URL', 'https://api.test');
    vi.stubGlobal('fetch', fetchFake);
    return render(
      <MemoryRouter initialEntries={['/signin?mode=signup']}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/app" element={<h1>Workspace</h1>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('is sent to the app when already signed in', async () => {
    mountAt(async (input) =>
      String(input).endsWith('/api/me') ? Response.json({ userId: 'u1' }) : new Response('', { status: 404 }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument());
  });

  it('keeps the form when signed out', async () => {
    mountAt(async () => new Response('', { status: 401 }));
    await screen.findByLabelText('Email address');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('heading', { name: 'Workspace' })).toBeNull();
  });
});

describe('the human check', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function fakeTurnstile(token: string | null) {
    const turnstile = {
      render: vi.fn((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
        if (token) opts.callback(token);
        return 'widget-1';
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('turnstile', turnstile);
    return turnstile;
  }

  it('sends the widget token with a link request and resets the widget afterwards', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    const turnstile = fakeTurnstile('tok-1');
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount();

    await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: 'site-key', action: 'signin' });

    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));

    await waitFor(() => expect(request).toHaveBeenCalled());
    const body = JSON.parse(String((request.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ email: 'owner@example.com', turnstileToken: 'tok-1' });
    await waitFor(() => expect(turnstile.reset).toHaveBeenCalledWith('widget-1'));
  });

  it('explains a refused check instead of a generic failure', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    fakeTurnstile('tok-1');
    const request = vi.fn().mockResolvedValue(
      Response.json({ ok: false, err: 'Please complete the security check and try again.', code: 'TURNSTILE' }, { status: 400 }),
    );
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('security check');
  });

  it('is absent without a site key, and sends no token', async () => {
    const turnstile = fakeTurnstile('tok-1');
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a link/i }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(turnstile.render).not.toHaveBeenCalled();
    expect(JSON.parse(String((request.mock.calls[0][1] as RequestInit).body))).toEqual({ email: 'owner@example.com' });
  });
});
