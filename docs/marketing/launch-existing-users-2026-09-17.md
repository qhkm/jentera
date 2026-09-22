# Jentera launch email — existing users

17 September 2026. Authorized extension of the approved waitlist launch email,
excluding founder/test accounts and existing recipients. The opening and footer
reflect account creation rather than waitlist signup. The trial wording explicitly
does not reset already-consumed requests. Pricing, fair-use qualifiers, the
pricing-feedback section, founder reply-to and payment-only WhatsApp benefit are
preserved. No private group invitation is included.

Subject: Jentera is officially open 🇲🇾 — thank you for joining us early

From: Qaiyyum at Jentera <hello@jentera.ai>

Reply-to: qhkmdev90@gmail.com

HTML companion: `launch-existing-users-2026-09-17.html`.

Campaign: `jentera-launch-users-20260917`.

Send receipt: local ignored `launch-existing-users-2026-09-17-state.json`.
It stores recipient hashes and provider message IDs, not addresses or credentials.
The existing production `waitlist_notice` has a foreign key to the waitlist;
do not add users to the subscriber list merely to record this send.

## Authorized existing-user send — completed

The founder requested sending the launch email to existing users while excluding
related testing accounts, then explicitly confirmed excluding Qimi Coffee.
The reviewed recipient set was frozen to 19 verified addresses not already
recorded by the waitlist campaign. Known exclusions: `qhkmdev90@gmail.com`,
`akukauhamba@gmail.com`, `qaiyyumhakimi@gmail.com`, `qimicoffee@gmail.com`.
AISAR-related email/name/business matches were excluded by the preflight; none
were found. One unverified account was not mailed. An additional already-mailed
account appeared during the recheck, without changing the 19 recipients.

- Resend accepted 19/19; API failures: 0; accepted-send receipts: 19; pending: 0.
- HTML and full plain text were sent individually, without CC/BCC.
- Content SHA-256 of `JSON.stringify({subject,text,html})`:
  `e98fcb87b0b8bbc0ea1b6300727b1682233ff0e26d3aff2afcae76716fdae7b2`.
- Every acceptance was persisted locally before acknowledging the next send.
  Stable per-recipient idempotency keys and the saved receipt protect retries.
  Keep the local receipt: provider idempotency is time-limited, not a permanent
  campaign ledger. Do not start another campaign or remove the receipt to retry.
- The production database session was read-only, and no waitlist entries,
  account access, usage balances, billing, permissions or deployments changed.
- Provider acceptance is verified, not actual inbox delivery, opens, clicks or
  Gmail/Outlook rendering. No API key was saved to source or a credential file.

Replies and mailto unsubscribe requests go to `qhkmdev90@gmail.com` via the
explicit Reply-To header, matching the waitlist campaign. Resend inbound email
and an in-platform inbox are not configured; this send did not enable them.

## Email body

Hi,

You created a Jentera account earlier.

Today, Jentera is officially open. 🇲🇾

Before anything else, I just want to say thank you.

You’re one of the very first people to create an account and try Jentera.

When you’re building something new, those early sign-ups, messages, feedback and words of support mean a lot more than people realise.

So thank you for being one of the early supporters of Jentera.

If you haven’t given it a real task yet, now’s a great time to start.

Meet your 24/7 AI staff

Jentera is an AI staff member for your business.

Unlike a normal AI chatbot, Jentera has its own computer and can actually do work for you.

Give it a task the same way you would give work to a new staff member:

“Research these 20 companies and put everything into a spreadsheet.”

“Read these documents and prepare a summary for me.”

“Check this website and tell me what you find.”

“Help me prepare a quotation from this customer enquiry.”

“Compare these supplier quotations and prepare a summary.”

Pass je kerja dekat Jentera.

Start here:
https://jentera.ai/signin

Sign in with Google or email to return to your account. Your free trial includes up to 10 chat requests, shared across your conversations; any requests you’ve already used still count.

No card required.

One thing I’d love you to try

Don’t just ask Jentera a question.

Think of one annoying task you keep repeating in your business.

Something you wish you could just pass to someone else.

Give Jentera the actual file, website, example or instructions and let it try. Some tasks may need a connected account or your approval before they can continue.

That’s the easiest way to understand why we built this.

Special launch offer

Because you joined us early, you can get Jentera at our launch price:

RM99/month for your first 3 monthly billing periods.
Then RM199/month from month 4.

You’ll get:

• Your own AI staff, available 24/7
• Its own dedicated computer
• AI usage included for day-to-day work
• Early access to new Jentera features
• Private WhatsApp support group with me, available after payment is confirmed
• Direct founder support while we’re still early

Usage and fair-use limits apply. This is not unlimited AI usage.

Plan details: https://jentera.ai/pricing
Terms & cancellation: https://jentera.ai/terms

Help us get the pricing right

We’re still figuring out the best long-term pricing and included AI usage for Jentera. Your feedback will help us build something useful, affordable and sustainable.

Does the price feel fair for your business? What usage would you expect to be included? Just reply with your thoughts or suggestions—I’d genuinely love to hear them.

You’re one of our very first Jentera users.

That means you’re not just an early user. You’re part of the group helping us figure out what Jentera should become.

So after you try it, just reply to this email and tell me:

What did you ask Jentera to do?

Good, bad, confusing, impressive — I want to hear all of it.

I read every reply, and your feedback will directly influence what we build next.

Again, thank you for supporting Jentera this early.

We’re just getting started.

Qaiyyum
Founder, Jentera.ai

—
You received this because you created a Jentera account.
Reply “unsubscribe” if you don’t want further launch updates.
