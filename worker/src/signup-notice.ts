/* ============================================================
   One plain-text email to the operator each time an account is made.

   Fired by the three sign-in routes when the session says `created`,
   never on a return visit, and handed to `ctx.waitUntil` so a slow or
   refusing Resend cannot delay or fail the sign-in. `SIGNUP_NOTICE_TO`
   unset means nobody is told; nothing else changes.
   ============================================================ */
import type { Env } from './env';
import { withUser } from './db';
import { sendNotice } from './email';

export type SignupDoor = 'magic-link' | 'password' | 'google';

const DOOR: Record<SignupDoor, string> = {
  'magic-link': 'a magic link',
  password: 'a password',
  google: 'Google',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `13 Sep 2026, 09:42 MYT` — Malaysia time, month spelled here rather
    than by ICU, which writes "Sept" in some releases. */
export function malaysiaTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]} ${get('year')}, ${hour}:${get('minute')} MYT`;
}

export function signupNoticeText(input: {
  email: string;
  door: SignupDoor;
  verified: boolean;
  at: Date;
  accounts: number;
}): { subject: string; text: string } {
  return {
    subject: `New Jentera signup: ${input.email}`,
    text: [
      `${input.email} signed up with ${DOOR[input.door]} (address ${input.verified ? 'verified' : 'not yet verified'})`,
      malaysiaTime(input.at),
      `Accounts now: ${input.accounts}`,
    ].join('\n'),
  };
}

/** Never throws: a notice that cannot be sent is logged and forgotten. */
export async function notifySignup(
  env: Env,
  input: { email: string; door: SignupDoor },
): Promise<boolean> {
  const to = env.SIGNUP_NOTICE_TO?.trim();
  if (!to) return false;
  try {
    const [row] = await withUser(env, (sql) => sql<{ verified: boolean; accounts: number }[]>`
      select email_verified as verified,
             (select count(*)::int from app_user) as accounts
        from app_user
       where email = ${input.email}
    `);
    if (!row) return false;
    const { subject, text } = signupNoticeText({
      email: input.email, door: input.door, verified: row.verified, at: new Date(), accounts: row.accounts,
    });
    return await sendNotice(env, to, subject, text);
  } catch (error) {
    console.error(`[signup-notice] not sent for ${input.email}: ${String(error)}`);
    return false;
  }
}
