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
