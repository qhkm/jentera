/* ============================================================
   Three ways into the same account.

   Google first, because it is the only one with no inbox round trip
   and no password to remember — and this audience is overwhelmingly on
   Gmail. Password second, for anyone who wants it. Magic link last, as
   the path that always works.

   The three converge: whichever is used, the server issues the same
   session cookie, so nothing downstream knows or cares which was.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import { useSignedInRedirect } from "@/hooks/useSignedInRedirect";
import { clearAskStorage } from "@/hooks/useAsk";
import { pendingTrialInvite } from '@/lib/trial-link';
import {
  ArrowUpRight,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Link, Navigate, useSearchParams } from "react-router";
import { trackActivation } from "@/lib/analytics";
import { useTurnstile } from "@/lib/turnstile";
import { JenteraMark } from "@/components/JenteraMark";
import {
  handoffBrowserSession,
  isNative,
  signIn as signInNative,
} from '@/lib/native';

const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const NATIVE_STATE = /^[A-Za-z0-9._~-]{16,128}$/;
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;

type Mode = "signin" | "signup";
type BusyAction = "password" | "link" | null;

/* Errors the server can put in the query string when it bounces the
   browser back here. Mapped rather than printed, so a crafted ?error=
   cannot render arbitrary text on a sign-in page. */
const ERRORS: Record<string, string> = {
  expired:
    "That link has already been used or has expired. Request a new one below.",
  "google-failed": "Google sign-in did not complete. Please try again.",
  "google-unverified":
    "That Google account has an unverified email address, so we cannot use it to sign in.",
  "google-unavailable":
    "Google sign-in is not available right now. Use your email instead.",
};

function NativeSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openSignIn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await signInNative();
      if (next) window.location.replace(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marketing-page auth-entrance min-h-dvh bg-bg text-text">
      <div className="auth-atmosphere" aria-hidden="true"><span>Jentera</span></div>
      <main id="main-content" className="auth-layout">
        <div className="auth-card">
          <div className="auth-emblem"><JenteraMark size={64} /></div>
          <span className="auth-card-eyebrow">Secure sign-in</span>
          <h1>Welcome to Jentera.</h1>
          <p className="auth-card-description">
            Continue in your browser to sign in with Google, your password, or an email link.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-6 w-full"
            disabled={busy}
            onClick={() => void openSignIn()}
          >
            {busy ? 'Opening secure sign-in…' : 'Continue to sign in'}
          </button>
          {error ? <p role="alert" className="mt-3 text-sm opacity-80">{error}</p> : null}
          <p className="mt-5 text-xs text-text-secondary">
            Your Jentera session is stored securely on this device.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function SignIn() {
  return isNative() ? <NativeSignIn /> : <BrowserSignIn />;
}

function BrowserSignIn() {
  const [inviteCode] = useState(pendingTrialInvite);
  const [params, setParams] = useSearchParams();
  const nativeState = params.get('state') ?? '';
  const nativeChallenge = params.get('code_challenge') ?? '';
  const nativeHandoff = params.get('native') === '1' &&
      NATIVE_STATE.test(nativeState) && PKCE_VALUE.test(nativeChallenge)
    ? { state: nativeState, codeChallenge: nativeChallenge }
    : null;
  /* Already signed in: the workspace, not the form. A 401 leaves the form
     alone, so a magic link or a fresh sign-in still works. */
  useSignedInRedirect(
    '/app',
    inviteCode ? `/access?invite=1#code=${encodeURIComponent(inviteCode)}` : '/access',
    nativeHandoff === null,
  );
  const [mode, setMode] = useState<Mode>(() =>
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [sent, setSent] = useState<"link" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const captcha = useTurnstile();
  const emailInput = useRef<HTMLInputElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const restoreEmailFocus = useRef(false);

  /* Deliberately NOT an effect that mints on arrival.
     
     The code minted here is a 7-day credential for this account, and the
     challenge it is bound to comes from the query string, so whoever wrote
     the link chose it. An effect that fired on load meant a link sent to a
     signed-in owner silently minted a code against their session and handed
     it to whatever app claims the ai.jentera.app scheme — the attacker's,
     if they installed one. PKCE cannot help: the attacker owns the verifier.
     
     A tap is not a complete fix, and the real control is a verified App Link
     so only the signed app can receive the callback. But it removes the
     silent case, which is the one nobody can notice. */
  const [handoffBusy, setHandoffBusy] = useState(false);
  const returnToApp = async () => {
    if (!nativeHandoff) return;
    setHandoffBusy(true);
    try {
      if (await handoffBrowserSession(nativeHandoff)) return;
      setError('Your browser session could not be returned to the Jentera app.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not return to the Jentera app.');
    } finally {
      setHandoffBusy(false);
    }
  };

  useEffect(() => {
    if (sent) confirmationHeading.current?.focus({ preventScroll: true });
    else if (restoreEmailFocus.current) {
      emailInput.current?.focus();
      restoreEmailFocus.current = false;
    }
  }, [sent]);

  useEffect(() => {
    /* Prevent a previous account's private owner conversation appearing if
       this tab is used to sign into a different account. */
    clearAskStorage();
  }, []);

  useEffect(() => {
    setMode(params.get("mode") === "signup" ? "signup" : "signin");
    setSent(null);
    setError(null);
  }, [params]);

  const urlError = ERRORS[params.get("error") ?? ""] ?? null;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    trackActivation(mode === "signup" ? "signup_started" : "signin_started");
    setBusy("password");
    setError(null);
    try {
      const turnstileToken = await captcha.getToken();
      const res = await fetch(
        `${API}/api/auth/${mode === "signup" ? "signup" : "login"}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(inviteCode ? { inviteCode } : {}),
            ...(turnstileToken ? { turnstileToken } : {}),
          }),
        },
      );

      if (mode === "signup") {
        // 202 either way — the address may already be taken, and the
        // server deliberately does not say which.
        if (res.ok) setSent("verify");
        else
          setError(
            (await res.json().catch(() => ({}))).err ??
              "Could not sign you up.",
          );
        return;
      }

      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { next?: unknown };
        if (nativeHandoff) {
          if (await handoffBrowserSession(nativeHandoff)) return;
          setError('Your browser session could not be returned to the Jentera app.');
          return;
        }
        // Full reload, not a client-side navigate: RepositoryGate reads
        // the session once at startup, so the app has to boot again to
        // pick up the cookie that was just set.
        const inviteReturn = typeof body.next === 'string' && /^\/access\?invite=1#code=[A-Za-z0-9_-]{32,100}$/.test(body.next);
        window.location.href = inviteReturn ? String(body.next) : ["/onboard", "/setup", "/app", "/access"].includes(
          String(body.next),
        )
          ? String(body.next)
          : "/app";
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { err?: string };
      setError(body.err ?? "Email or password is incorrect.");
    } catch {
      setError("Could not reach Jentera. Check your connection.");
    } finally {
      captcha.reset();
      setBusy(null);
    }
  }

  async function sendLink() {
    if (!emailInput.current?.reportValidity()) return;
    setBusy("link");
    setError(null);
    try {
      /* The same success response is shown whether or not an account
         exists. Transport failures still need an honest retry state. */
      const turnstileToken = await captcha.getToken();
      const response = await fetch(`${API}/api/auth/request`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(inviteCode ? { inviteCode } : {}),
          ...(turnstileToken ? { turnstileToken } : {}),
          ...(nativeHandoff ? {
            native: true,
            state: nativeHandoff.state,
            codeChallenge: nativeHandoff.codeChallenge,
          } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          err?: string;
          code?: string;
        };
        setError(
          response.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : body.code === "TURNSTILE"
              ? (body.err ??
                "Please complete the security check and try again.")
              : "Could not send your sign-in link. Please try again.",
        );
        return;
      }
      setSent("link");
    } catch {
      setError("Could not reach Jentera. Check your connection and try again.");
    } finally {
      captcha.reset();
      setBusy(null);
    }
  }

  function alternateModeParams(): URLSearchParams {
    const next = new URLSearchParams(params);
    if (mode === 'signup') next.delete('mode');
    else next.set('mode', 'signup');
    return next;
  }

  const alternateQuery = alternateModeParams().toString();
  const alternateModeHref = `/signin${alternateQuery ? `?${alternateQuery}` : ''}`;

  if (mode === 'signup' && import.meta.env.VITE_ACCESS_MODE === 'waitlist') return <Navigate to="/waitlist" replace />;

  return (
    <div className="marketing-page auth-entrance min-h-dvh bg-bg text-text">
      <div className="auth-atmosphere" aria-hidden="true">
        <span>Jentera</span>
      </div>
      <header className="auth-header">
        <Link
          to="/"
          className="font-pixel text-2xl text-brand"
          aria-label="Jentera home"
        >
          <JenteraMark size={32} />
          Jentera<span className="auth-parent">by AISAR</span>
        </Link>
        <Link
          to={alternateModeHref}
          className="lp-text-link"
        >
          {mode === "signup" ? "Sign in" : "Get started"}
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </header>
      <main id="main-content" className="auth-layout">
        {sent ? (
          <div className="auth-card auth-confirmation" role="status">
            <EnvelopeSimple
              size={32}
              weight="duotone"
              className="text-brand"
              aria-hidden="true"
            />
            <h1 ref={confirmationHeading} tabIndex={-1}>
              Check your inbox
            </h1>
            <p>
              {sent === "verify" ? (
                <>
                  If <strong>{email}</strong> is not already registered, a link
                  to confirm it is on its way. Follow it to finish setting up
                  your account.
                </>
              ) : (
                <>
                  If <strong>{email}</strong> has a Jentera account, a sign-in
                  link is on its way. It works once and expires in 15 minutes.
                </>
              )}
            </p>
            <p className="text-text-secondary">
              Can’t find it? Check your spam or junk folder too.
            </p>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                restoreEmailFocus.current = true;
                setSent(null);
                setError(null);
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="auth-card">
            <div className="auth-emblem">
              <JenteraMark size={64} />
            </div>
            <span className="auth-card-eyebrow">
              For the business you already run
            </span>
            <h1>
              {mode === "signup" ? "Create your account" : "Welcome back."}
            </h1>
            <p className="auth-card-description">
              {mode === "signup"
                ? "A little about you. Then, your business."
                : "Sign in to pick up where you left off."}
            </p>

            {urlError ? (
              <p role="alert" className="mt-3 text-sm opacity-80">
                {urlError}
              </p>
            ) : null}
            {inviteCode && <p role="status" className="mt-3 text-sm text-brand">Your exclusive invitation will continue after sign-in. Your trial starts only when you confirm.</p>}

            {nativeHandoff ? (
              <section className="card mt-4 px-4 py-3" aria-label="Return to the Jentera app">
                <strong className="block text-[14px]">Continue in the Jentera app</strong>
                <p className="m-0 mt-1 text-[13px] text-text-secondary">
                  If you are already signed in here, this hands your session to the app on
                  this device. Only continue if you opened this page from Jentera yourself.
                </p>
                <button
                  type="button"
                  className="btn mt-3"
                  disabled={handoffBusy}
                  onClick={() => { void returnToApp(); }}
                >
                  {handoffBusy ? 'Returning…' : 'Return to the Jentera app'}
                </button>
              </section>
            ) : null}

            <form method={inviteCode ? 'post' : 'get'} action={`${API}/api/auth/google`} className="mt-6">
              {inviteCode ? <input type="hidden" name="inviteCode" value={inviteCode} /> : null}
              {nativeHandoff ? <>
                <input type="hidden" name="native" value="1" />
                <input type="hidden" name="state" value={nativeHandoff.state} />
                <input type="hidden" name="codeChallenge" value={nativeHandoff.codeChallenge} />
              </> : null}
              <button
                type="submit"
                className="btn btn-outline flex w-full items-center justify-center gap-2"
                disabled={Boolean(busy)}
                onClick={() => {
                trackActivation(
                  mode === "signup" ? "signup_started" : "signin_started",
                );
              }}
              >
              {/* Inline rather than a remote asset: the page must not
                depend on Google being reachable to render its own
                sign-in button. */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                aria-hidden="true"
              >
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
                />
              </svg>
                Continue with Google
              </button>
            </form>

            <div className="mt-6 flex items-center gap-3 text-xs text-text-secondary">
              <span className="h-px flex-1 bg-rail" />
              or use your email
              <span className="h-px flex-1 bg-rail" />
            </div>

            <form onSubmit={submitPassword} className="auth-form">
              <label htmlFor="signin-email">Email address</label>
              <input
                className="input w-full"
                id="signin-email"
                ref={emailInput}
                type="email"
                required
                autoComplete="email"
                placeholder="you@yourbusiness.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="signin-password">Password</label>
              <div className="auth-password">
                <input
                  className="input w-full"
                  id="signin-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={10}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder={
                    mode === "signup"
                      ? "At least 10 characters"
                      : "Your password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? (
                    <EyeSlash size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>

              {captcha.enabled ? (
                <div ref={captcha.attach} className="turnstile mt-4" />
              ) : null}

              {error ? (
                <p role="alert" className="mt-3 text-sm opacity-80">
                  {error}
                </p>
              ) : null}

              <button
                className="btn btn-primary mt-5 w-full"
                type="submit"
                disabled={Boolean(busy) || !email || !password}
              >
                {busy === "password"
                  ? mode === "signup"
                    ? "Creating your account…"
                    : "Signing you in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            {/* A login link can only be issued for an existing account. Showing
              it during signup silently sent nothing for a new address, which
              looked like broken email. Google remains the passwordless new-
              account path; the link returns once the account exists. */}
            {mode === "signin" ? (
              <button
                type="button"
                className="nav-link mt-4 w-full text-sm normal-case tracking-normal"
                onClick={sendLink}
                disabled={Boolean(busy) || !email}
              >
                {busy === "link"
                  ? "Sending your secure link…"
                  : "Email me a link instead"}
              </button>
            ) : null}

            <p className="mt-6 text-center text-sm text-text-secondary">
              {mode === "signup"
                ? "Already have an account?"
                : "No account yet?"}{" "}
              <button
                type="button"
                className="nav-link normal-case tracking-normal"
                disabled={Boolean(busy)}
                onClick={() => {
                  setParams(alternateModeParams());
                }}
              >
                {mode === "signup" ? "Sign in" : "Create one"}
              </button>
            </p>

            <p className="auth-private">
              <ShieldCheck size={14} aria-hidden="true" /> Private to you and
              your business.
            </p>
          </div>
        )}
      </main>
      <footer className="auth-footer">
        <Link to="/" className="lp-text-link">
          ← Back to Jentera
        </Link>
        <Link to="/onboard" className="lp-text-link">
          Explore the setup first <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
