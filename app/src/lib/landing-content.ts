/* Public copy follows the positioning agreed on 8 September 2026.
   Jentera is the product; AISAR is the parent. Examples are illustrations,
   and planned connections are never presented as available features. */

export const HERO = {
  eyebrow: "Introducing Jentera · Built for business here",
  headline: ["AI staff that works 24/7", "for Malaysian businesses."],
  detail:
    "You already built the business. Jentera helps with the enquiries, follow-ups, paperwork, and everyday jobs that take up your time.",
  ctaPrimary: "Meet Jentera",
  ctaSecondary: "See how it helps",
};

export const BUSINESS_EXAMPLES = [
  {
    id: "kopitiam",
    label: "Kopitiam",
    name: "Kedai Kopi Kita",
    location: "Petaling Jaya, Malaysia",
    request: "Help me prepare for the week ahead.",
    tasks: [
      "Draft this week’s lunch specials",
      "Prepare a reply to a catering enquiry",
      "Compare the supplier options I shared",
    ],
    draftTitle: "A reply you can make your own",
    draft:
      "Hi! Thanks for thinking of us for your team lunch. How many people are joining, and which date did you have in mind? I’ll put together a menu for you.",
    context: "Prepared from the menu and catering details you confirm.",
  },
  {
    id: "clinic",
    label: "Klinik",
    name: "Klinik Kejiranan",
    location: "Shah Alam, Malaysia",
    request: "Help me get the front desk organised.",
    tasks: [
      "Draft answers to opening-hours enquiries",
      "Prepare an appointment reminder",
      "Write a front-desk handover checklist",
    ],
    draftTitle: "One less message to write",
    draft:
      "Hi! This is a reminder about your appointment tomorrow. Please reply to confirm, or let us know if you need to reschedule. Thank you.",
    context:
      "An administrative draft for your review. No patient data in this example.",
  },
  {
    id: "catering",
    label: "Catering",
    name: "Dapur Bersama",
    location: "Johor Bahru, Malaysia",
    request: "Help me get ready for this weekend’s events.",
    tasks: [
      "Turn the event brief into a prep checklist",
      "Draft a guest-count confirmation",
      "Summarise the orders I shared",
    ],
    draftTitle: "The details, ready to confirm",
    draft:
      "Hi! We’re getting everything ready for your event this weekend. Could you confirm the final guest count, serving time, and any dietary requirements?",
    context: "Prepared from the event details and menu you provide.",
  },
  {
    id: "retail",
    label: "Kedai",
    name: "Kedai Harian",
    location: "Kuching, Malaysia",
    request: "Help me organise the shop’s next steps.",
    tasks: [
      "Draft a response to a product enquiry",
      "Prepare a supplier follow-up",
      "Summarise the sales figures I shared",
    ],
    draftTitle: "Keep the conversation moving",
    draft:
      "Hi! Thanks for your interest. Which item are you looking for, and how many would you need? I’ll check the details and get back to you.",
    context:
      "A draft based on your business details. Stock is confirmed by you.",
  },
] as const;

export const EVERYDAY_WORK = [
  {
    number: "01",
    icon: "chat",
    kicker: "Enquiries",
    title: "Replies ready when you need them.",
    body: "Opening hours, menu questions, and booking enquiries, in Bahasa and English. Jentera prepares a reply using the details you confirm.",
    example: "“Draft a reply about tomorrow’s opening hours.”",
  },
  {
    number: "02",
    icon: "document",
    kicker: "Follow-ups",
    title: "Keep every job moving.",
    body: "Quotes, no-shows, and invoices. Jentera helps you prepare the next step, ready for you to send or approve.",
    example: "“Prepare a follow-up for this catering quote.”",
  },
  {
    number: "03",
    icon: "search",
    kicker: "Operations",
    title: "Know what needs attention.",
    body: "Turn the orders, stock notes, and figures you share into clear checklists and weekly summaries.",
    example: "“Turn these order notes into a weekly summary.”",
  },
  {
    number: "04",
    icon: "shield",
    kicker: "Human approvals",
    title: "You decide what goes out.",
    body: "Jentera can prepare the routine work. Anything that spends money or reaches outside your business waits for your decision.",
    example: "Important actions need your approval.",
  },
] as const;

export const SETUP_STEPS = [
  {
    number: "01",
    title: "Describe it.",
    body: "A sentence about what your existing business does, in Bahasa or English.",
  },
  {
    number: "02",
    title: "Check the details.",
    body: "Review what Jentera learned about your business and correct anything that needs changing.",
  },
  {
    number: "03",
    title: "Give it a job.",
    body: "Ask for something useful, review the result, and decide what happens next.",
  },
] as const;

export const TRADE_TYPES = [
  ["🍜", "Restaurant"],
  ["🛍️", "Retail"],
  ["🛒", "Online seller"],
  ["🎪", "Catering"],
  ["📸", "Photography"],
  ["🍰", "Bakery"],
  ["💍", "Wedding services"],
  ["💼", "Services"],
  ["🏥", "Clinic"],
  ["💇", "Salon"],
  ["🏋️", "Gym"],
  ["📚", "Tuition"],
  ["🧺", "Laundry"],
  ["🔧", "Auto workshop"],
  ["🐾", "Pet care"],
  ["💐", "Florist"],
  ["🏠", "Property"],
  ["🧽", "Cleaning"],
  ["🏪", "Minimart"],
] as const;

export const FAQS = [
  {
    question: "Is Jentera for a business like mine?",
    answer:
      "Jentera is built for small businesses and solopreneurs who already trade: shops, cafés, clinics, caterers, and service businesses. Start with a specific piece of everyday work, such as drafting replies, preparing a checklist, or researching a supplier.",
  },
  {
    question: "Do I need technical skills?",
    answer:
      "No. Describe your business in ordinary language, review the details, and ask Jentera to help with a task. There are no models, API keys, or servers for you to configure.",
  },
  {
    question: "Does it connect to WhatsApp?",
    answer:
      "WhatsApp is part of our direction, but it is not available yet. Today, you can work with Jentera in the web workspace and through your paired private Telegram chat.",
  },
  {
    question: "Does Jentera handle e-invoicing?",
    answer:
      "Not yet. Local accounting and compliance are part of why we are building for this region, but Jentera does not currently submit e-invoices or connect to MyInvois.",
  },
  {
    question: "Will it send messages to my customers?",
    answer:
      "Your first connection is a private Telegram chat with you, the owner. The examples on this page show drafts for review. Customer-facing WhatsApp messaging and automatic booking connections are not currently available.",
  },
  {
    question: "What is the relationship between AISAR and Jentera?",
    answer:
      "AISAR builds AI agents that run Southeast Asian businesses. Jentera is the product you use to put those agents to work. The technology behind it stays behind the scenes.",
  },
] as const;

export const NAV_LINKS = [
  { href: "/#work", label: "What it does" },
  { href: "/#how", label: "How it works" },
  { href: "/connect", label: "Connections" },
  { href: "/#aisar", label: "About AISAR" },
];

export const FOOTER = {
  tagline: "AI agents for the business you already run.",
  email: "hello@kitakodventures.com",
  links: [
    { href: "https://aisar.ai", label: "AISAR ↗" },
    { href: "https://github.com/qhkm", label: "Open source ↗" },
    { href: "https://x.com/qhkmdev9", label: "Updates ↗" },
  ],
  copyright: "© 2026 Kitakod Ventures.",
  registration: "SSM 202203226187 (003430123-M)",
};
