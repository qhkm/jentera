/* ============================================================
   The only file that knows about email.

   Confined deliberately: swapping Resend for anything else should
   touch this file and nothing else.
   ============================================================ */

import type { Env } from './env';

/**
 * No AISAR domain is verified in Resend yet — the account has loyca.ai,
 * pantas.ai and three .app domains, none of which should appear on an
 * AISAR sign-in email. Sending from an unrelated brand reads as phishing
 * to the recipient and costs deliverability.
 *
 * Until `aisar.ai` (or `jentera.ai`) is verified, set MAGIC_FROM to a
 * verified sender and this will use it; otherwise the link is logged
 * rather than sent, so the whole flow stays testable.
 */
const FROM = 'AISAR <hello@aisar.ai>';

export async function sendMagicLink(env: Env, email: string, url: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] no RESEND_API_KEY — link for ${email}: ${url}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: 'Your AISAR sign-in link',
      text: [
        'Sign in to AISAR:',
        '',
        url,
        '',
        'This link works once and expires in 15 minutes.',
        "If you didn't ask for it, you can ignore this email.",
      ].join('\n'),
    }),
  });

  if (!res.ok) {
    // Log and swallow: the caller answers 204 regardless, so a send
    // failure must not become an account-existence signal.
    console.error(`[email] resend ${res.status}: ${await res.text()}`);
  }
}
