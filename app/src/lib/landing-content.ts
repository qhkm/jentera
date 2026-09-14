/* Public copy follows the positioning agreed on 8 September 2026.
   Jentera is the product; AISAR is the parent. Examples are illustrations,
   and planned connections are never presented as available features. */

export const HERO = {
  eyebrow: "Launching 16 September 2026 · Built for Malaysian businesses",
  headline: {
    lead: "AI staff that works 24/7",
    preposition: "for",
    flag: "🇲🇾",
    country: "Malaysian",
    audience: "businesses.",
  },
  detail:
    "Give Jentera a job. It uses a dedicated computer to research, prepare files and handle everyday tasks—with your business knowledge and approval controls.",
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
    kicker: "Enquiries and follow-ups",
    title: "Keep enquiries moving.",
    body: "Build a routine around a connected inbox: check new enquiries against your business knowledge, prepare replies and flag leads that need a follow-up. Review before sending.",
    example: "“Check new enquiries each morning and queue replies for my approval.”",
  },
  {
    number: "02",
    icon: "document",
    kicker: "Social media operations",
    title: "Turn content into a publishing routine.",
    body: "Use the performance reports you provide to plan the next batch of posts. Review the content, then schedule publishing through supported connections.",
    example: "“Review last week’s results and prepare next week’s posts for approval.”",
  },
  {
    number: "03",
    icon: "document",
    kicker: "Quotes and invoices",
    title: "Move from enquiry to quotation.",
    body: "Read client requirements, use your confirmed price list and prepare a quotation file. With a supported sending connection, send it after approval and record the follow-up date.",
    example: "“Prepare a quote from this enquiry and flag any missing details before sending.”",
  },
  {
    number: "04",
    icon: "chat",
    kicker: "Inbox triage",
    title: "Bring important emails to you.",
    body: "Set up checks for a connected mailbox, separate routine messages from items needing attention and prepare a summary with suggested replies for your review.",
    example: "“Every weekday, summarise important emails and draft replies without sending.”",
  },
  {
    number: "05",
    icon: "chat",
    kicker: "Scheduled monitoring",
    title: "Watch supplier prices.",
    body: "Set up a routine to check the supplier pages you specify, compare them with saved prices and prepare a change report.",
    example: "“Check these supplier pages every Friday and flag price changes.”",
  },
  {
    number: "06",
    icon: "document",
    kicker: "Files and records",
    title: "Keep your working files updated.",
    body: "Collect information from accessible sources and update a report or spreadsheet in your workspace. External records require supported access and any necessary approval.",
    example: "“Read these order files and update my order tracker.”",
  },
  {
    number: "07",
    icon: "search",
    kicker: "Daily checks",
    title: "Check what needs your attention.",
    body: "Schedule a review of the sources you make available. Return to a saved report of changes and items to check, without starting a new chat each morning.",
    example: "“Every morning, review this stock file and flag items below my minimum.”",
  },
  {
    number: "08",
    icon: "shield",
    kicker: "Repeatable routines",
    title: "Put your SOP to work.",
    body: "Set up a routine around your instructions: read the inputs, follow the checks and save the output. Review the results and anything that needs a decision.",
    example: "“Run this weekly reporting checklist and save the report for my review.”",
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
    question: "How does the launch offer work?",
    answer:
      "Jentera officially launches on 16 September 2026. Our special launch offer is RM99/month. Purchases are not open yet; you can join the waitlist for launch updates. Joining is free and does not start a subscription or guarantee the promotional price. We’ll publish the offer end date, promotional duration, renewal pricing and fair-use details before you subscribe.",
  },
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
  { href: "/#pricing", label: "Pricing" },
  { href: "/#control", label: "Your control" },
];

export const FOOTER = {
  tagline: "Built by AISAR for Malaysian businesses.",
  email: "hello@kitakodventures.com",
  links: [
    { href: "https://aisar.ai", label: "AISAR ↗" },
    { href: "https://github.com/qhkm", label: "Open source ↗" },
    { href: "https://x.com/qhkmdev9", label: "Updates ↗" },
  ],
  copyright: "© 2026 Kitakod Ventures.",
  registration: "SSM 202203226187 (003430123-M)",
};
