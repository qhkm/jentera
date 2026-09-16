/* ============================================================
   The only file that knows about email.

   Confined deliberately: swapping Resend for anything else should
   touch this file and nothing else.
   ============================================================ */

import type { Env } from './env';

/**
 * The sender must match the domain the link points at.
 *
 * APP_ORIGIN is https://jentera.ai — that is the live site and what sits
 * in the user's URL bar. An email from a different domain than the link
 * it carries is the exact shape of a phishing message, and both spam
 * filters and cautious recipients treat it that way. So: jentera.ai,
 * not aisar.ai, whatever the product is called.
 *
 * Overridable because staging and preview origins differ. Missing delivery
 * configuration is logged without the address or authentication link. Tests
 * inspect a mocked send; bearer links must never become log material.
 */
const FROM = 'Jentera <hello@jentera.ai>';

/**
 * Which message to send with the link.
 *
 * 'exists' goes out when someone tries to sign up with an address that
 * already has an account. The HTTP response is identical to a real
 * signup so the attempt reveals nothing, but the person who actually
 * owns the address deserves to know what happened — and gets a working
 * sign-in link rather than a confusing "verify your new account".
 */
export type LinkKind = 'signin' | 'verify' | 'exists';

const COPY: Record<LinkKind, { subject: string; lead: string }> = {
  signin: { subject: 'Your Jentera sign-in link', lead: 'Sign in to Jentera:' },
  verify: {
    subject: 'Confirm your Jentera account',
    lead: 'Confirm this address to finish setting up your Jentera account:',
  },
  exists: {
    subject: 'Your Jentera sign-in link',
    lead:
      'Someone tried to create a Jentera account with this address, and one ' +
      'already exists. Your password was not changed. Sign in here:',
  },
};

export async function sendMagicLink(
  env: Env,
  email: string,
  url: string,
  kind: LinkKind = 'signin',
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn('[email] authentication delivery unavailable: provider not configured');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAGIC_FROM || FROM,
      to: [email],
      subject: COPY[kind].subject,
      text: [
        COPY[kind].lead,
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
    console.error(`[email] authentication delivery refused: status=${res.status}`);
  }
}

/** A plain-text notice to one address, same sender as the magic link.
    Returns false (and logs) when the key is unset or Resend refuses.

    `headers` carries message headers the recipient's client acts on —
    List-Unsubscribe on anything that is not transactional. Announcement
    mail shares a domain with the sign-in link, so an unsubscribe a
    person can actually use is what keeps a spam complaint from landing
    on the address that has to deliver magic links. */
export async function sendNotice(
  env: Env,
  email: string,
  subject: string,
  text: string,
  headers?: Record<string, string>,
  replyTo?: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn('[email] notice delivery unavailable: provider not configured');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAGIC_FROM || FROM,
      to: [email],
      subject,
      text,
      ...(headers ? { headers } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    console.error(`[email] notice delivery refused: status=${res.status}`);
    return false;
  }
  return true;
}
