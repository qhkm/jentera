/* Public copy follows the launch brief agreed on 16 September 2026.
   Jentera is the product; AISAR is the parent. Examples are illustrations,
   and planned connections are never presented as available features. */

import { launchOffer } from '@/lib/launch-offer';

export const HERO = {
  eyebrow: "Early access · Built in Malaysia",
  headline: {
    lead: "AI staff that works 24/7",
    preposition: "for",
    flag: "🇲🇾",
    country: "Malaysian",
    audience: "businesses.",
  },
  detail:
    "Just hand the work to Jentera. Research, admin, reports and customer follow-up drafts—your AI staff has its own computer and can keep working while you’re away.",
  ctaPrimary: 'Try my AI staff — 10 free chats',
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

export const FIRST_WORKFLOW_EXAMPLES = [
  { title: 'Sales research', request: 'Find 30 potential customers in Kuala Lumpur and put them into a spreadsheet.' },
  { title: 'Quotation preparation', request: 'When I give you customer details, prepare a quotation using my template.' },
  { title: 'Weekly reporting', request: 'Every Friday, use the figures I provide to prepare my weekly report.' },
  { title: 'Research & monitoring', request: 'Check these public competitor websites every Monday and tell me if their prices change.' },
  { title: 'Customer follow-up drafts', request: 'Use my customer list to identify who needs a follow-up and prepare messages for my review.' },
] as const;

export const EVERYDAY_WORK = [
  {
    number: "01",
    icon: "chat",
    kicker: "Enquiries and follow-ups",
    title: "Keep enquiries moving.",
    body: "Share your enquiry list and business details. Jentera can organise the leads, flag who needs attention and prepare follow-up messages for your review.",
    example: "“Organise these enquiries and draft follow-ups for me to review.”",
  },
  {
    number: "02",
    icon: "document",
    kicker: "Marketing preparation",
    title: "Get next week’s content ready.",
    body: "Turn your brief, product details and past results into a content plan and draft posts. Review and publish them through your own channels.",
    example: "“Use this product list to prepare five posts for next week.”",
  },
  {
    number: "03",
    icon: "document",
    kicker: "Quotation preparation",
    title: "Move from enquiry to quotation.",
    body: "Share the customer requirements, your price list and a template. Jentera can prepare a quotation file and flag missing details before you send it.",
    example: "“Prepare a quote using my template and flag anything missing.”",
  },
  {
    number: "04",
    icon: "search",
    kicker: "Sales research",
    title: "Find your next opportunities.",
    body: "Research public business websites, compare prospects and organise the findings into a lead list. Check the sources before you reach out.",
    example: "“Research 30 potential business customers in KL and make a spreadsheet.”",
  },
  {
    number: "05",
    icon: "search",
    kicker: "Website checks",
    title: "Watch supplier prices.",
    body: "Compare accessible public supplier pages with the prices you saved. Get a clear report of what changed and what to check next.",
    example: "“Compare these supplier prices with last week’s list.”",
  },
  {
    number: "06",
    icon: "document",
    kicker: "Files and records",
    title: "Keep your working files updated.",
    body: "Upload your order files or spreadsheet. Jentera can organise the information and prepare an updated tracker in its workspace for you to check.",
    example: "“Read these order files and update my order tracker.”",
  },
  {
    number: "07",
    icon: "document",
    kicker: "Business reporting",
    title: "Turn the numbers into a report.",
    body: "Share your sales figures, orders or stock files. Jentera can summarise the numbers, highlight exceptions and prepare your next report.",
    example: "“Use this spreadsheet to prepare my weekly sales report.”",
  },
  {
    number: "08",
    icon: "shield",
    kicker: "Your own process",
    title: "Put your SOP to work.",
    body: "Share your checklist, the inputs and what a good result looks like. Ask Jentera to follow the same process on the next job, then review the output.",
    example: "“Follow this reporting checklist and save the result for my review.”",
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
    question: 'Can I try Jentera before paying?',
    answer: 'Yes. Create and verify your account to explore the platform and send 10 free chat requests. The allowance is shared across all your chats and businesses, not 10 per conversation. After that, upgrade to keep sending work. Requests already in progress can finish, and previous results stay readable. The launch plan is RM99/month for your first 3 months, then RM199/month.',
  },
  {
    question: "How does the launch offer work?",
    answer:
      `The launch offer is RM${launchOffer.monthlyPrice}/month for your first ${launchOffer.introductoryMonths} monthly billing periods, then RM${launchOffer.renewalPrice}/month from month 4. Your plan includes your AI staff, its own dedicated computer and AI usage subject to fair-use limits. Paid early users also get private WhatsApp support, direct founder access and early access to new features. Your founder-group invitation appears in your workspace after payment is confirmed. Review usage limits and cancellation terms before subscribing.`,
  },
  {
    question: "Is Jentera for a business like mine?",
    answer:
      "If your team repeats computer-based work across spreadsheets, documents and browser tabs, start there. Jentera is built for Malaysian small businesses and solopreneurs—from shops and online sellers to agencies and service businesses. Pick one task, such as a quotation, a supplier comparison or a weekly report.",
  },
  {
    question: "Do I need technical skills?",
    answer:
      "No. Explain the job like you would to a staff member, share the files or details it needs, and review the result. Start with one task; there are no models, API keys, or servers for you to configure. Some websites and tools still need your sign-in or permission.",
  },
  {
    question: "Is AI usage unlimited?",
    answer:
      "No. Your subscription includes standard AI usage, with usage and fair-use limits. A multi-step job can use more AI than a simple question. Review the plan’s usage limits before subscribing; the launch offer does not promise unlimited usage.",
  },
  {
    question: 'How many computer tasks can run at once?',
    answer: 'Your AI staff handles one computer task at a time. The plan includes one dedicated computer, not several AI staff working in parallel.',
  },
  {
    question: "Can Jentera run work on a schedule?",
    answer:
      "Recurring routines are currently in a limited pilot and are not enabled for every account. We can help you identify repeatable work and check whether your workflow can join the pilot. Supported access, setup and any required approvals still apply.",
  },
  {
    question: "Does it connect to WhatsApp?",
    answer:
      "Founder WhatsApp support is part of the launch offer; it is human onboarding and support, not an AI WhatsApp connector. Today, you can work with Jentera in the web workspace and through your paired private Telegram chat. Customer-facing WhatsApp automation is not available yet.",
  },
  {
    question: "Does Jentera handle e-invoicing?",
    answer:
      "Not yet. Local accounting and compliance are part of why we are building for this region, but Jentera does not currently submit e-invoices or connect to MyInvois.",
  },
  {
    question: "Will it send messages to my customers?",
    answer:
      "Your paired private Telegram chat is for you, the owner—not your customers. The follow-up examples on this page are drafts for you to review and send through your own channels. Customer-facing WhatsApp messaging is not available yet.",
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
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
    { href: "https://aisar.ai", label: "AISAR ↗" },
    { href: "https://github.com/qhkm", label: "Open source ↗" },
    { href: "https://x.com/qhkmdev9", label: "Updates ↗" },
  ],
  copyright: "© 2026 Kitakod Ventures.",
  registration: "SSM 202203226187 (003430123-M)",
};
