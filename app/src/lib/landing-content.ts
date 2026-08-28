/* ============================================================
   Landing copy, ported verbatim from index.html.

   Deliberately not routed through i18n: the static landing has no
   data-t attributes and ships English only. Inventing BM strings
   here would diverge from the source rather than match it. The
   dashboard stays bilingual because that is where the engine
   actually has both tables.
   ============================================================ */

export interface Panel {
  eyebrow: string;
  title: string;
  body: string;
  /** small mono chips under the body */
  tags?: string[];
}

export interface Section {
  id?: string;
  eyebrow: string;
  title: string;
  lede: string;
  panels: Panel[];
  /** grid template for the panel row */
  columns: string;
}

export const HERO = {
  headline: ['Your business,', 'without the busywork.'],
  promise: 'You explain the business. Jentera handles the technology.',
  detail:
    'It finds, sets up, and puts the right AI help to work — without technical skills, expensive consultants, or workflows to configure.',
  ticker: 'Jentera is learning how wagyu.my works',
  ctaPrimary: 'Set up my business',
  ctaSecondary: 'See the magic →',
  stats: [
    { value: '0', label: 'Technical skills' },
    { value: '5', label: 'minute first setup' },
    { value: '∞', label: 'Opportunities found' },
  ],
};

export const BUILT_FOR: Section = {
  eyebrow: 'Built for business owners',
  title: "You shouldn't need a developer to put AI to work.",
  lede: 'If you can explain how your business runs, you can use Jentera. No coding, prompt engineering, technical team, or expensive implementation project.',
  columns: 'md:grid-cols-3',
  panels: [
    {
      eyebrow: 'Speak business',
      title: 'Start with what you already know.',
      body: 'Share your website and socials, or describe the outcome you want in ordinary language.',
    },
    {
      eyebrow: 'Jentera handles setup',
      title: 'The technical work stays behind the curtain.',
      body: 'Jentera finds the opportunity, prepares the right AI help, and connects only what it needs.',
    },
    {
      eyebrow: 'You stay in control',
      title: 'Review it before it starts working.',
      body: 'Approve access and sensitive actions, then see what Jentera completed and where it needs you.',
    },
  ],
};

export const HOW_IT_WORKS: Section = {
  id: 'how',
  eyebrow: 'How it works',
  title: 'You know your business. Jentera learns it.',
  lede: 'Most AI tools give you another system to learn. Jentera learns your business and handles the setup behind the scenes.',
  columns: 'sm:grid-cols-2 lg:grid-cols-4',
  panels: [
    {
      eyebrow: '01 — Share',
      title: 'Start with what you already have.',
      body: 'Share your website and socials, or describe the business yourself. Jentera turns it into a profile you can review.',
    },
    {
      eyebrow: '02 — Find',
      title: 'Jentera spots the busywork.',
      body: 'It finds where AI can help most, ranks each opportunity by impact, and shows you what is ready to put to work.',
    },
    {
      eyebrow: '03 — Put to work',
      title: 'It sets up and connects everything.',
      body: 'Your private Jentera chat comes first. Customer channels and business systems are connected later, only when you choose them.',
    },
    {
      eyebrow: '04 — Improve',
      title: 'It keeps finding the next opportunity.',
      body: '“You copy reservations into a spreadsheet every Friday. I can handle that—would you like me to?”',
    },
  ],
};

export const WHAT_IT_RUNS: Section = {
  id: 'runs',
  eyebrow: 'What it runs',
  title: 'Your team, under the hood',
  lede: 'Jentera organises everything around the work your business needs done. The technical plumbing stays out of your way.',
  columns: 'lg:grid-cols-2',
  panels: [
    {
      eyebrow: 'Private workspace',
      title: 'Business Assistant',
      body: 'Works with you on operations, research, planning, writing, and everyday business questions. Private to your business and not customer-facing by default.',
      tags: ['Private Telegram', 'Internal use', 'Ready first'],
    },
    {
      eyebrow: 'Reservations',
      title: 'Booking Agent',
      body: 'Checks availability against your calendar, creates bookings, sends confirmations and reminders automatically. No booking form required.',
      tags: ['Calendar', 'Confirmations', 'Reminders'],
    },
    {
      eyebrow: 'Follow-up',
      title: 'Customer Follow-up',
      body: 'Follows up past customers, special occasions, and abandoned enquiries — turning one-time buyers into regulars without you lifting a finger.',
      tags: ['Revenue opportunity', 'Personalised'],
    },
    {
      eyebrow: 'Operations',
      title: 'Inventory · Orders · Reports',
      body: 'Watches your spreadsheets and systems, automates supplier ordering, and prepares your weekly business report every Monday morning.',
      tags: ['Sheets', 'AutoCount', 'Weekly report'],
    },
  ],
};

export const START_BUSINESS: Section = {
  id: 'start',
  eyebrow: 'Something new?',
  title: 'Jentera can start a business too',
  lede: "Tell Jentera what you're thinking about building — it researches the market, shapes the business model, picks your stack, and sets up your AI team before launch.",
  columns: 'sm:grid-cols-2 lg:grid-cols-3',
  panels: [
    {
      eyebrow: 'Idea → Research',
      title: '"I want to sell Malaysian coffee internationally."',
      body: 'Jentera researches the market, defines the customer, and shapes a business model — single-origin subscription for premium coffee drinkers in SG/JP.',
    },
    {
      eyebrow: 'Model → Systems',
      title: 'Offer, brand, channels, stack.',
      body: 'Jentera picks your offer and brand direction, then sets up the operations — store, payments, email, support, accounting — connected and ready.',
    },
    {
      eyebrow: 'AI Team → Launch',
      title: 'A working AI team, day one.',
      body: 'Marketing, support, content, operations, analytics — your AI team is live before you even launch. You run the business; it runs the busywork.',
    },
  ],
};

/** The scripted terminal exchange in the onboarding preview. */
export const DEMO_STEPS: { who: 'jentera' | 'you'; text: string; delay: number; typing?: boolean }[] = [
  { who: 'jentera', text: "What's your website?", delay: 0.2 },
  { who: 'you', text: 'wagyu.my', delay: 1 },
  {
    who: 'jentera',
    text: 'I found that you operate a premium Japanese restaurant in Kuala Lumpur. Is that correct?',
    delay: 2,
    typing: true,
  },
  { who: 'you', text: 'Yes', delay: 3.8 },
  { who: 'jentera', text: "I'm ready to handle this for you:", delay: 4.8 },
];

export const ONBOARDING = {
  id: 'onboarding',
  eyebrow: 'See it in action',
  title: 'The entire onboarding',
  lede: 'From “AI could help my business” to a private assistant you can talk to—without learning a new technical tool.',
  cardTitle: 'Business Assistant',
  cardHandles: 'Helps with: operations · research · planning · writing',
  cardNeeds: 'Private chat: Telegram [Connect] · Business profile [Found ✓]',
  activate: 'Put Jentera to work →',
  activating: 'Putting Jentera to work…',
  activated: '✓ Working',
  doneMessage:
    "Your private Business Assistant is ready. Ask about operations, research, planning, or anything you need to get done.",
  asideEyebrow: 'What just happened',
  asideTitle: 'From zero to working AI in under 5 minutes.',
  asidePoints: [
    'Jentera scanned your website and learned your business',
    'It found the repetitive work with the highest impact',
    'It prepared a private assistant and explained every connection',
    'No coding, technical team, or workflows to build',
  ],
  asideBody:
    'Behind the scenes, Jentera handles the AI, knowledge, connections, testing, and monitoring. You only see what is ready, what needs approval, and what was completed.',
};

export const CLOSING_CTA = {
  headline: ['You run the business.', 'Jentera runs the busywork.'],
  body: 'You explain the business. Jentera handles the technology and puts the right AI help to work.',
  cta: 'Set up my business',
};

export const NAV_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#runs', label: 'What it runs' },
  { href: '#onboarding', label: 'See it in action' },
];

export const FOOTER = {
  tagline: 'Your business, without the busywork.',
  email: 'hello@kitakodventures.com',
  links: [
    { href: 'https://kitakodventures.com', label: 'Kitakod Ventures' },
    { href: 'https://github.com/qhkm', label: 'GitHub' },
    { href: 'https://x.com/qhkmdev9', label: 'X' },
  ],
  copyright: '© 2026 Kitakod Ventures. All rights reserved.',
  registration: 'SSM 202203226187 (003430123-M)',
};
