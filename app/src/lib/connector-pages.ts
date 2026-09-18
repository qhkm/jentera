/* ============================================================
   Long-form pages for connections that actually work.

   One page per member of LIVE_CONNECTORS and nothing else. A page for
   a planned connector would be a page about a thing that does nothing —
   the exact claim live-connectors.ts exists to prevent, and thin enough
   that a search engine would be right to ignore it.

   `limits` is not a disclaimer section bolted on at the end. It is the
   part of each page a reader needs most, because every one of these
   sentences has been asked as a question by someone who assumed
   otherwise.
   ============================================================ */

import { LIVE_CONNECTORS } from '@/lib/live-connectors';

export interface ConnectorPage {
  /** URL segment under /connect. */
  slug: string;
  /** Must match its LIVE_CONNECTORS entry exactly. */
  name: string;
  icon: string;
  availability: 'available' | 'pilot';
  eyebrow: string;
  headline: string;
  lede: string;
  does: { title: string; body: string }[];
  limits: string[];
  steps: { title: string; body: string }[];
  /** Related reading. Internal links are how a new page gets discovered. */
  related: { href: string; label: string }[];
}

export const CONNECTOR_PAGES: ConnectorPage[] = [
  {
    slug: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    availability: 'available',
    eyebrow: 'Available now',
    headline: 'Your business, in a private Telegram chat.',
    lede:
      'Pair one Telegram chat with your Jentera AI staff and give it work from your phone. '
      + 'Ask for a draft on the way to the shop, read the result when it is done. '
      + 'The chat belongs to you, the owner — your customers are never added to it.',
    does: [
      {
        title: 'Give it a job from your phone',
        body:
          'Describe the work the way you would to a member of staff. Jentera does it on its own computer '
          + 'and replies in the same chat when there is something to read.',
      },
      {
        title: 'Research and planning',
        body:
          'Ask it to look something up, compare public supplier pages, or turn a brief into a plan. '
          + 'Check the sources it cites before you act on them.',
      },
      {
        title: 'Business memory',
        body:
          'What you tell it about your business stays available to the next conversation, so you are not '
          + 'reintroducing your own shop every time you open the chat.',
      },
      {
        title: 'Task updates',
        body:
          'Longer jobs report back when they finish or when they need a decision from you, rather than '
          + 'leaving you to check the workspace.',
      },
    ],
    limits: [
      'This chat is for you, the owner. Jentera does not message your customers on Telegram.',
      'Anything customer-facing comes back as a draft for you to review and send through your own channels.',
      'Your AI staff runs one computer task at a time. Pairing Telegram does not add a second.',
      'Work you start in Telegram and work you start in the web workspace draw on the same plan allowance.',
    ],
    steps: [
      { title: 'Create your account', body: 'Sign up and verify your email address. You get 10 free chat requests to try the platform before subscribing.' },
      { title: 'Open Connections', body: 'In your workspace, choose Telegram and follow the guided pairing. Jentera handles the bot token, the webhook and the owner-chat lock for you.' },
      { title: 'Send it the first job', body: 'Message the chat like you would a colleague. If the reply is not what you wanted, say so in the same chat.' },
    ],
    related: [
      { href: '/connect', label: 'Every connection, available and planned' },
      { href: '/pricing', label: 'What the plan costs' },
      { href: '/privacy', label: 'How your data is handled' },
    ],
  },
  {
    slug: 'bukku',
    name: 'Bukku',
    icon: '📒',
    availability: 'available',
    eyebrow: 'Available now',
    headline: 'Ask your accounts a question, get an answer.',
    lede:
      'Connect Bukku and Jentera can tell you who has not paid you, without you opening a ledger '
      + 'or exporting a spreadsheet. It reads your books. It does not write to them.',
    does: [
      {
        title: 'Who owes you money',
        body:
          'Ask in plain words and Jentera reads your outstanding and overdue invoices — who, how much, '
          + 'and how long. Overdue is whatever Bukku says it is, not a date sum of ours, so the answer '
          + 'matches what you would see if you opened Bukku yourself.',
      },
      {
        title: 'Your customer list, when it is needed',
        body:
          'Looking up a contact while drafting a reply or a quotation no longer means switching apps and '
          + 'copying a name across.',
      },
      {
        title: 'Your token never leaves Jentera',
        body:
          'The credential stays in Jentera’s control plane. Your AI staff asks for a reading and receives '
          + 'an answer in words — it never holds the key to your accounts, so nothing it reads on the web '
          + 'can talk it into handing one over.',
      },
    ],
    limits: [
      'Reading only. Jentera cannot create, edit, send or void anything in Bukku.',
      'Invoices and contacts. Bills, payments, journals and reports are not covered yet.',
      'One Bukku company per business. Connect the company whose books you want it to read.',
      'A token you can revoke. Turn API access off in Bukku and the connection stops working immediately.',
    ],
    steps: [
      { title: 'Create your account', body: 'Sign up and verify your email address, then open your workspace.' },
      { title: 'Turn on API access in Bukku', body: 'In Bukku, open Control Panel → Integrations and turn on API Access. Copy the token it generates, and note your company subdomain — the name in your Bukku address.' },
      { title: 'Paste it into Connections', body: 'Choose Bukku in Connections, paste the token and the subdomain. Jentera checks both against Bukku before saving, and tells you which one is wrong if either is.' },
    ],
    related: [
      { href: '/connect', label: 'Every connection, available and planned' },
      { href: '/privacy', label: 'How your data is handled' },
      { href: '/pricing', label: 'What the plan costs' },
    ],
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    icon: '📅',
    availability: 'pilot',
    eyebrow: 'Pilot · permission verification pending',
    headline: 'Calendar events, prepared for you to approve.',
    lede:
      'Let Jentera read your primary Google Calendar so it knows what your week looks like, and let it '
      + 'prepare events you approve before anything is added. Nothing is written to your calendar without '
      + 'your say-so, and nothing is booked automatically.',
    does: [
      {
        title: 'Know what your week holds',
        body:
          'Jentera can check your primary calendar so a plan, a reply or a reminder it prepares fits around '
          + 'what you have already committed to.',
      },
      {
        title: 'Prepare an event, not book one',
        body:
          'Ask for an event and you get one ready to add, with the details filled in. You see it before it '
          + 'exists on your calendar.',
      },
      {
        title: 'You approve every write',
        body:
          'Adding an event is an action that waits on your decision. The approval gate is the same one that '
          + 'governs everything Jentera does outside its own computer.',
      },
    ],
    limits: [
      'A pilot connection. Google permission verification is still pending, so availability may change.',
      'Only your primary calendar. Secondary and shared calendars are not covered.',
      'No automatic booking. Jentera never accepts, declines or schedules on your behalf without approval.',
      'It does not message attendees. Any note to a guest comes back as a draft for you to send.',
    ],
    steps: [
      { title: 'Create your account', body: 'Sign up and verify your email address, then open your workspace.' },
      { title: 'Connect Google', body: 'Choose Google Calendar in Connections and grant access to your primary calendar. You can revoke it from your Google account at any time.' },
      { title: 'Ask, then approve', body: 'Ask Jentera to prepare an event. Review what it has drafted and approve it before it reaches your calendar.' },
    ],
    related: [
      { href: '/connect', label: 'Every connection, available and planned' },
      { href: '/privacy', label: 'What Google data is used for' },
      { href: '/terms', label: 'Approvals and your responsibilities' },
    ],
  },
];

export function connectorPage(slug: string): ConnectorPage | undefined {
  return CONNECTOR_PAGES.find((page) => page.slug === slug);
}

/** Guards the invariant the comment at the top of this file describes.
 * Called by the test, not at runtime. */
export function unbackedConnectorPages(): string[] {
  return CONNECTOR_PAGES.filter((page) => !LIVE_CONNECTORS.has(page.name)).map((page) => page.name);
}
