/* Public copy follows the positioning agreed on 8 September 2026.
   Jentera is the product; AISAR is the parent. Examples are illustrations,
   and planned connections are never presented as available features. */

export const HERO = {
  eyebrow: 'AI agents for Southeast Asian businesses',
  headline: ['You built the business.', 'Let Jentera help run it.'],
  detail:
    'The shop is open. The orders are coming in. The paperwork can wait—until it can’t. Give the everyday work to an AI agent that learns your business.',
  ctaPrimary: 'Put Jentera to work',
  ctaSecondary: 'Explore an example',
};

export const BUSINESS_EXAMPLES = [
  {
    id: 'kopitiam',
    label: 'Kopitiam',
    name: 'Kedai Kopi Kita',
    location: 'Petaling Jaya, Malaysia',
    request: 'Help me prepare for the week ahead.',
    tasks: [
      'Draft this week’s lunch specials',
      'Prepare a reply to a catering enquiry',
      'Compare the supplier options I shared',
    ],
    draftTitle: 'A reply you can make your own',
    draft:
      'Hi! Thanks for thinking of us for your team lunch. How many people are joining, and which date did you have in mind? I’ll put together a menu for you.',
    context: 'Prepared from the menu and catering details you confirm.',
  },
  {
    id: 'clinic',
    label: 'Klinik',
    name: 'Klinik Kejiranan',
    location: 'Shah Alam, Malaysia',
    request: 'Help me get the front desk organised.',
    tasks: [
      'Draft answers to opening-hours enquiries',
      'Prepare an appointment reminder',
      'Write a front-desk handover checklist',
    ],
    draftTitle: 'One less message to write',
    draft:
      'Hi! This is a reminder about your appointment tomorrow. Please reply to confirm, or let us know if you need to reschedule. Thank you.',
    context: 'An administrative draft for your review. No patient data in this example.',
  },
  {
    id: 'catering',
    label: 'Catering',
    name: 'Dapur Bersama',
    location: 'Johor Bahru, Malaysia',
    request: 'Help me get ready for this weekend’s events.',
    tasks: [
      'Turn the event brief into a prep checklist',
      'Draft a guest-count confirmation',
      'Summarise the orders I shared',
    ],
    draftTitle: 'The details, ready to confirm',
    draft:
      'Hi! We’re getting everything ready for your event this weekend. Could you confirm the final guest count, serving time, and any dietary requirements?',
    context: 'Prepared from the event details and menu you provide.',
  },
  {
    id: 'retail',
    label: 'Kedai',
    name: 'Kedai Harian',
    location: 'Kuching, Malaysia',
    request: 'Help me organise the shop’s next steps.',
    tasks: [
      'Draft a response to a product enquiry',
      'Prepare a supplier follow-up',
      'Summarise the sales figures I shared',
    ],
    draftTitle: 'Keep the conversation moving',
    draft:
      'Hi! Thanks for your interest. Which item are you looking for, and how many would you need? I’ll check the details and get back to you.',
    context: 'A draft based on your business details. Stock is confirmed by you.',
  },
] as const;

export const EVERYDAY_WORK = [
  {
    number: '01',
    icon: 'chat',
    title: 'The questions you’ve answered before.',
    body: 'Opening hours. Your services. What’s on the menu. Turn the details you confirm into useful answers and ready-to-review replies.',
    example: '“Draft a reply about our catering packages.”',
  },
  {
    number: '02',
    icon: 'document',
    title: 'The paperwork at the end of the day.',
    body: 'Give Jentera the notes, figures, or order details you’re working with. Get a clear summary, a checklist, or a first draft back.',
    example: '“Turn these notes into a weekly update.”',
  },
  {
    number: '03',
    icon: 'search',
    title: 'The decisions that need a little homework.',
    body: 'Research suppliers, compare options, and prepare the next step. Put your time into the decisions that need you.',
    example: '“Compare these suppliers for my shop.”',
  },
] as const;

export const SETUP_STEPS = [
  {
    number: '01',
    title: 'Tell us what you already do.',
    body: 'Describe your business or share your website. A kedai, a clinic, a one-person operation—start with what you know.',
  },
  {
    number: '02',
    title: 'Make sure we’ve got it right.',
    body: 'Review your business profile and the details Jentera should know. You can correct and add to them as you go.',
  },
  {
    number: '03',
    title: 'Give Jentera its first job.',
    body: 'Start in your private workspace or pair your Telegram chat. Ask for something useful, then review the result.',
  },
] as const;

export const FAQS = [
  {
    question: 'Is Jentera for a business like mine?',
    answer:
      'Jentera is built for small businesses and solopreneurs who already trade: shops, cafés, clinics, caterers, and service businesses. Start with a specific piece of everyday work, such as drafting replies, preparing a checklist, or researching a supplier.',
  },
  {
    question: 'Do I need technical skills?',
    answer:
      'No. Describe your business in ordinary language, review the details, and ask Jentera to help with a task. There are no models, API keys, or servers for you to configure.',
  },
  {
    question: 'Does it connect to WhatsApp?',
    answer:
      'WhatsApp is part of our direction, but it is not available yet. Today, you can work with Jentera in the web workspace and through your paired private Telegram chat.',
  },
  {
    question: 'Does Jentera handle e-invoicing?',
    answer:
      'Not yet. Local accounting and compliance are part of why we are building for this region, but Jentera does not currently submit e-invoices or connect to MyInvois.',
  },
  {
    question: 'Will it send messages to my customers?',
    answer:
      'Your first connection is a private Telegram chat with you, the owner. The examples on this page show drafts for review. Customer-facing WhatsApp messaging and automatic booking connections are not currently available.',
  },
  {
    question: 'What is the relationship between AISAR and Jentera?',
    answer:
      'AISAR builds AI agents that run Southeast Asian businesses. Jentera is the product you use to put those agents to work. The technology behind it stays behind the scenes.',
  },
] as const;

export const NAV_LINKS = [
  { href: '/#work', label: 'What it does' },
  { href: '/#how', label: 'How it works' },
  { href: '/connect', label: 'Connections' },
  { href: '/#aisar', label: 'About AISAR' },
];

export const FOOTER = {
  tagline: 'AI agents for the business you already run.',
  email: 'hello@kitakodventures.com',
  links: [
    { href: 'https://aisar.ai', label: 'AISAR ↗' },
    { href: 'https://github.com/qhkm', label: 'Open source ↗' },
    { href: 'https://x.com/qhkmdev9', label: 'Updates ↗' },
  ],
  copyright: '© 2026 Kitakod Ventures.',
  registration: 'SSM 202203226187 (003430123-M)',
};
