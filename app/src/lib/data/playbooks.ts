/* Ported verbatim from biz-engine.js (PLAYBOOKS).
   Data only — regenerate rather than hand-edit if the source moves. */

import type { Playbook } from '../types';

export const PLAYBOOKS: Record<string, Playbook> = {
  "restaurant": {
    "icon": "🍜",
    "keywords": [
      "restaurant",
      "cafe",
      "café",
      "kedai makan",
      "kopi",
      "kopitiam",
      "food",
      "bistro",
      "warung",
      "mamak",
      "grill",
      "sushi",
      "pizza",
      "burger",
      "dapur",
      "kafe"
    ],
    "kw": {
      "ID": [
        "nasi padang",
        "warteg",
        "rumah makan"
      ]
    },
    "name": "Your Restaurant",
    "type": "Restaurant / Café",
    "sub": "Restaurant / Café",
    "site": "yourbusiness.com",
    "booking": "Phone + Instagram DM",
    "systems": "Google Sheets · POS",
    "potential": 62,
    "opportunities": 4,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "restaurant · premium · Kuala Lumpur",
    "loc": "Kuala Lumpur, MY",
    "confirm": "I found that you operate a restaurant/café in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Reservations",
        "green",
        "live"
      ],
      [
        "Follow-up",
        "green",
        "live"
      ],
      [
        "Inventory & ordering",
        "amber",
        "opportunity"
      ],
      [
        "Weekly reports",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "12",
        "u": "",
        "l": "conversations handled",
        "s": "4 needed you"
      },
      {
        "d": "Reservations",
        "v": "7",
        "u": "",
        "l": "new bookings this week",
        "s": "3 via WhatsApp"
      },
      {
        "d": "Hours saved",
        "v": "18",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 64
      }
    ],
    "sug": {
      "t": "Automate your Friday export",
      "d": "You manually export reservations to Sheets every Friday. AISAR can do this automatically.",
      "tag": "est. 1 hr/month",
      "cta": "Automation queued — I'll take care of the Friday export."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers FAQs, menu questions, opening hours and policies — 24/7, in your voice. Escalates complaints.",
        "m": "Today · 12 chats · 4 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Confirmations",
        "d": "Checks availability, creates bookings, sends confirmations and reminders automatically.",
        "m": "This week · 7 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past customers",
        "d": "Follows up past customers, special occasions, and abandoned enquiries — turning one-time buyers into regulars.",
        "m": "This month · 23 follow-ups"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Watches your spreadsheets, automates supplier ordering, and prepares your weekly business report every Monday.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Do you have halal certification?\" with menu + certification link."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "Instagram · 1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Created booking for 2 pax, Sat 8pm — sent confirmation + reminder."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent birthday promo to 6 past customers (personalised, in brand voice)."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer complained about wrong order delivery — AISAR apologised and offered 10% off. Review before sending?",
        "cta": "Approved — 10% discount voucher sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant & Follow-up use this to talk to customers.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Booking Agent receives reservation DMs here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent checks availability and creates events.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads reservations & inventory here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Accounting / POS",
        "s": "not connected",
        "d": "Unlocks ordering automation + weekly P&L reports.",
        "on": false,
        "cta": "Accounting connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "retail": {
    "icon": "🛍️",
    "keywords": [
      "retail",
      "e-commerce",
      "ecommerce",
      "shop",
      "store",
      "kedai runcit",
      "fashion",
      "baju",
      "pakaian",
      "online store",
      "marketplace",
      "shopee",
      "lazada",
      "tiktok shop",
      "homeware",
      "kosmetik",
      "product",
      "distributor"
    ],
    "name": "Your Store",
    "type": "Retail / E-commerce",
    "sub": "Retail / E-commerce",
    "site": "yourstore.my",
    "booking": "Shopee / Website checkout",
    "systems": "Shopify · Google Sheets",
    "potential": 58,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "e-commerce · home & living · Shah Alam",
    "loc": "Shah Alam, MY",
    "confirm": "I found that you run a home & living e-commerce business in Shah Alam. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Order status",
        "green",
        "live"
      ],
      [
        "Abandoned carts",
        "green",
        "live"
      ],
      [
        "Returns",
        "amber",
        "opportunity"
      ],
      [
        "Weekly reports",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "34",
        "u": "",
        "l": "orders processed",
        "s": "6 support tickets"
      },
      {
        "d": "Orders this week",
        "v": "211",
        "u": "",
        "l": "across your channels",
        "s": "9 refunds handled"
      },
      {
        "d": "Hours saved",
        "v": "22",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 71
      }
    ],
    "sug": {
      "t": "Automate abandoned cart recovery",
      "d": "Shoppers leave carts every day. AISAR follows up automatically with a personalised message + offer.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll take care of cart recovery."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers product questions, stock, shipping and policy FAQs — 24/7.",
        "m": "Today · 34 chats · 6 escalated"
      },
      {
        "e": "📦",
        "n": "Order Tracker",
        "ch": "Store · Email",
        "d": "Tracks orders and sends status updates automatically as items ship.",
        "m": "This week · 41 updates"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Abandoned carts · Past customers",
        "d": "Recovers abandoned carts and nudges repeat-purchase in your brand voice.",
        "m": "This month · 17 campaigns"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Watches stock levels, reorders best-sellers, and prepares your weekly sales report.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Is this available in size L?\" with stock + product link."
      },
      {
        "e": "📦",
        "n": "Order Tracker",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Sent tracking update for order #1024 — out for delivery."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent cart recovery to 5 shoppers who abandoned checkout yesterday."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer complained about late delivery — AISAR apologised and offered free shipping. Review before sending?",
        "cta": "Approved — free shipping voucher sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant & Follow-up use this to talk to customers.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "Shop · linked",
        "d": "Customer Assistant answers product DMs here.",
        "on": true
      },
      {
        "e": "🛒",
        "n": "Store platform",
        "s": "linked",
        "d": "Order Tracker reads orders & fulfilment here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads inventory here.",
        "on": true
      },
      {
        "e": "💳",
        "n": "Payment gateway",
        "s": "not connected",
        "d": "Unlocks automatic refunds & failed-payment follow-ups.",
        "on": false,
        "cta": "Payment connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "smallretail": {
    "icon": "🛒",
    "keywords": [
      "butik",
      "boutique",
      "kasut",
      "shoe",
      "sneaker",
      "aksesori",
      "accessory",
      "handbag",
      "beg",
      "tudung",
      "hijab",
      "reseller",
      "preloved",
      "apparel",
      "clothing",
      "vintage",
      "kedai baju",
      "kedai kasut",
      "kedai aksesori",
      "kedai hadiah",
      "gift shop",
      "baju kurung",
      "baju melayu"
    ],
    "kw": {
      "ID": [
        "toko baju",
        "toko tas",
        "toko aksesoris",
        "konveksi"
      ]
    },
    "name": "Your Boutique",
    "type": "Small Retail / Kedai",
    "sub": "Small Retail / Kedai",
    "site": "yourboutique.my",
    "booking": "WhatsApp / Walk-in",
    "systems": "WhatsApp · Instagram · Google Sheets",
    "potential": 62,
    "opportunities": 4,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "small retail · fashion & lifestyle · Shah Alam",
    "loc": "Shah Alam, MY",
    "confirm": "I found that you run a small retail shop — boutique or kedai — taking orders via WhatsApp and walk-ins. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "WhatsApp orders",
        "green",
        "live"
      ],
      [
        "Inventory & ordering",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & rebooking",
        "amber",
        "opportunity"
      ],
      [
        "Weekly reports",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "26",
        "u": "",
        "l": "enquiries answered",
        "s": "3 needed you"
      },
      {
        "d": "Orders this week",
        "v": "47",
        "u": "",
        "l": "via WhatsApp & walk-in",
        "s": "2 pending payment"
      },
      {
        "d": "Hours saved",
        "v": "15",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 58
      }
    ],
    "sug": {
      "t": "Automate WhatsApp order intake",
      "d": "Customers order via WhatsApp all day — even when your shop is closed. AISAR captures orders, confirms sizes and prices, and sends receipts automatically.",
      "tag": "est. 6 hrs/month",
      "cta": "Automation queued — I'll take your orders on WhatsApp."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers product, size, stock and shop-hours questions — 24/7.",
        "m": "Today · 28 chats · 4 escalated"
      },
      {
        "e": "🛒",
        "n": "Order Taker",
        "ch": "WhatsApp · Walk-in",
        "d": "Captures orders, confirms details and sends receipts — no pen needed.",
        "m": "This week · 19 orders"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "WhatsApp · Past customers",
        "d": "Nudges repeat purchases and reminds customers about reserved items.",
        "m": "This month · 12 campaigns"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Stock · Reports",
        "d": "Watches stock levels, flags low items, and prepares your weekly sales report.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Kedai buka sampai pukul berapa?\" with store hours + location."
      },
      {
        "e": "🛒",
        "n": "Order Taker",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Captured order #241: 2x baju kurung (S, M) — payment pending."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent reorder nudge to 6 past customers whose size restock just arrived."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer asked about a bulk order (50 pcs) — AISAR checked with you before promising a price. Review?",
        "cta": "Approved — offer sent with 8% bulk discount."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant & Order Taker use this to talk to customers.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "Shop · linked",
        "d": "Customer Assistant answers product DMs here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads stock & orders here.",
        "on": true
      },
      {
        "e": "💳",
        "n": "Payment gateway",
        "s": "not connected",
        "d": "Unlocks automatic receipts & payment reminders.",
        "on": false,
        "cta": "Payment connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "catering": {
    "icon": "🎪",
    "keywords": [
      "catering",
      "katering",
      "buffet",
      "bento",
      "bento box",
      "tiffin",
      "hi-tea",
      "high tea",
      "caterer"
    ],
    "name": "Your Catering",
    "type": "Catering / Event",
    "sub": "Catering / Event",
    "site": "yourcatering.my",
    "booking": "WhatsApp / Phone",
    "systems": "WhatsApp · Google Sheets",
    "potential": 64,
    "opportunities": 4,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "catering & events · Kuala Lumpur",
    "loc": "Kuala Lumpur, MY",
    "confirm": "I found that you run a catering / event food business. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Event quotes",
        "green",
        "live"
      ],
      [
        "Order intake",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "amber",
        "opportunity"
      ],
      [
        "Weekly reports",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "14",
        "u": "",
        "l": "enquiries answered",
        "s": "5 quote requests"
      },
      {
        "d": "Events this month",
        "v": "9",
        "u": "",
        "l": "confirmed from quotes",
        "s": "3 pending deposit"
      },
      {
        "d": "Hours saved",
        "v": "12",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 55
      }
    ],
    "sug": {
      "t": "Automate event quote requests",
      "d": "Clients ask for buffet quotes at all hours. AISAR collects event details (date, pax, menu) and sends a quote — no back-and-forth.",
      "tag": "est. 5 hrs/month",
      "cta": "Automation queued — I'll handle quote requests."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers menu, pricing and availability questions — 24/7.",
        "m": "Today · 16 chats · 3 escalated"
      },
      {
        "e": "📝",
        "n": "Quote Agent",
        "ch": "WhatsApp · Form",
        "d": "Collects event details (date, pax, menu) and drafts quotes instantly.",
        "m": "This week · 6 quotes"
      },
      {
        "e": "📅",
        "n": "Event Coordinator",
        "ch": "Calendar · WhatsApp",
        "d": "Tracks confirmed events and reminds you about deposits and prep.",
        "m": "This month · 9 events"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Sheets · Reports",
        "d": "Watches ingredient stock and prepares post-event summaries.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Ada menu untuk 50 pax?\" with package options + price range."
      },
      {
        "e": "📝",
        "n": "Quote Agent",
        "t": "1h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent buffet quote for 19 Aug (80 pax, RM 28/pax) — awaiting deposit."
      },
      {
        "e": "📅",
        "n": "Event Coordinator",
        "t": "3h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booking confirmed for Saturday wedding — reminder set for prep day."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Client asked for halal certification documents — AISAR needs your copy to send. Review?",
        "cta": "Approved — cert sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant & Quote Agent use this to talk to clients.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "Shop · linked",
        "d": "Customer Assistant answers menu DMs here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads quotes & bookings here.",
        "on": true
      },
      {
        "e": "💳",
        "n": "Payment gateway",
        "s": "not connected",
        "d": "Unlocks automatic deposits & payment reminders.",
        "on": false,
        "cta": "Payment connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "photography": {
    "icon": "📸",
    "keywords": [
      "photography",
      "photographer",
      "foto",
      "gambar",
      "shoot",
      "video shoot",
      "videography",
      "videographer",
      "studio foto",
      "wedding shoot",
      "prewedding",
      "seni foto",
      "portfolio shoot"
    ],
    "name": "Your Studio",
    "type": "Photography / Video",
    "sub": "Photography / Video",
    "site": "yourstudio.my",
    "booking": "Calendly · WhatsApp",
    "systems": "Google Calendar · Portfolio",
    "potential": 60,
    "opportunities": 4,
    "ch": [
      "Instagram",
      "WhatsApp"
    ],
    "detect": "photography & videography · Kuala Lumpur",
    "loc": "Kuala Lumpur, MY",
    "confirm": "I found that you run a photography / videography studio. Is that correct?",
    "funcs": [
      [
        "Enquiry response",
        "",
        "covered"
      ],
      [
        "Booking slots",
        "green",
        "live"
      ],
      [
        "Gallery delivery",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "amber",
        "opportunity"
      ],
      [
        "Invoicing",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "18",
        "u": "",
        "l": "enquiries answered",
        "s": "4 booking requests"
      },
      {
        "d": "Shoots this month",
        "v": "11",
        "u": "",
        "l": "booked & scheduled",
        "s": "2 rescheduled"
      },
      {
        "d": "Hours saved",
        "v": "14",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 57
      }
    ],
    "sug": {
      "t": "Automate booking & reminder flow",
      "d": "Clients ask \"ada slot weekend ni?\" every day. AISAR checks your calendar, books slots and sends reminders — no double-booking.",
      "tag": "est. 4 hrs/month",
      "cta": "Automation queued — I'll handle bookings."
    },
    "team": [
      {
        "e": "💬",
        "n": "Lead Responder",
        "ch": "Instagram · WhatsApp",
        "d": "Answers package, price and availability questions — in seconds.",
        "m": "Today · 20 chats · 5 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · WhatsApp",
        "d": "Checks studio availability and books shoots without the back-and-forth.",
        "m": "This week · 7 bookings"
      },
      {
        "e": "🖼️",
        "n": "Client Assistant",
        "ch": "Email · Link",
        "d": "Delivers galleries, sends previews and reminds clients about prints.",
        "m": "This month · 12 deliveries"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Sheets · Invoicing",
        "d": "Tracks shoot invoices and chases late payments politely.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Lead Responder",
        "t": "Instagram · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa untuk prewedding outdoor?\" with package + sample link."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked family shoot — Sat 10am, studio A. Reminder sent to client."
      },
      {
        "e": "🖼️",
        "n": "Client Assistant",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Delivered wedding gallery — 230 edited photos, 24h download link."
      },
      {
        "e": "⚠️",
        "n": "Lead Responder",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Client wants a rush quote for corporate event coverage (3 days notice). AISAR asked if you can accept. Review?",
        "cta": "Approved — rush fee quoted."
      }
    ],
    "conns": [
      {
        "e": "📸",
        "n": "Instagram",
        "s": "Shop · linked",
        "d": "Lead Responder answers DMs & comments here.",
        "on": true
      },
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Booking Agent confirms sessions here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent reads availability from your studio calendar.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Invoicing",
        "s": "not connected",
        "d": "Unlocks automatic invoices & payment follow-ups after each shoot.",
        "on": false,
        "cta": "Invoicing wizard will open — we'll guide you through it."
      }
    ]
  },
  "bakery": {
    "icon": "🍰",
    "keywords": [
      "bakery",
      "bakeri",
      "kek",
      "cake",
      "cupcake",
      "donut",
      "brownie",
      "tart",
      "patisserie",
      "kedai kek",
      "biskut",
      "cookies",
      "artisan bread",
      "rotibakar"
    ],
    "name": "Your Bakery",
    "type": "Bakery / Patisserie",
    "sub": "Bakery / Patisserie",
    "site": "yourbakery.my",
    "booking": "WhatsApp / Walk-in",
    "systems": "WhatsApp · Instagram · Google Sheets",
    "potential": 63,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "bakery & patisserie · Shah Alam",
    "loc": "Shah Alam, MY",
    "confirm": "I found that you run a bakery / patisserie with custom pre-orders. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Custom pre-orders",
        "green",
        "live"
      ],
      [
        "Order reminders",
        "green",
        "live"
      ],
      [
        "Inventory & ordering",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & rebooking",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "22",
        "u": "",
        "l": "orders & questions handled",
        "s": "3 needed you"
      },
      {
        "d": "Cakes this week",
        "v": "31",
        "u": "",
        "l": "custom pre-orders",
        "s": "2 cancellations"
      },
      {
        "d": "Hours saved",
        "v": "16",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 61
      }
    ],
    "sug": {
      "t": "Automate custom cake orders",
      "d": "Customers describe cakes on WhatsApp at midnight. AISAR captures flavour, size and pickup date — then reminds them to confirm.",
      "tag": "est. 6 hrs/month",
      "cta": "Automation queued — I'll take cake orders."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers flavour, price and order-cutoff questions — 24/7.",
        "m": "Today · 24 chats · 3 escalated"
      },
      {
        "e": "🎂",
        "n": "Order Taker",
        "ch": "WhatsApp",
        "d": "Captures custom cake orders — flavour, size, pickup date, deposit.",
        "m": "This week · 18 orders"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "WhatsApp",
        "d": "Reminds customers to confirm & pay, and nudges repeat orders.",
        "m": "This month · 21 reminders"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Stock · Reports",
        "d": "Watches ingredient stock and flags what to bake more of.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Boleh order kek untuk esok?\" with cutoff + pickup info."
      },
      {
        "e": "🎂",
        "n": "Order Taker",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Captured order: chocolate 1kg, pickup Sat 3pm — deposit pending."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 4 customers about pickup tomorrow + payment confirmation."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer wants a 3-tier wedding cake with custom design — needs your quote. Review?",
        "cta": "Approved — quote sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant & Order Taker use this to talk to customers.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "Shop · linked",
        "d": "Customer Assistant answers DM orders here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads pre-orders & stock here.",
        "on": true
      },
      {
        "e": "💳",
        "n": "Payment gateway",
        "s": "not connected",
        "d": "Unlocks automatic deposit collection & receipts.",
        "on": false,
        "cta": "Payment connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "wedding": {
    "icon": "💍",
    "keywords": [
      "wedding",
      "perkahwinan",
      "nikah",
      "kenduri",
      "pelamin",
      "bridal",
      "hantaran",
      "event planner",
      "wedding planner",
      "decor",
      "dekorasi",
      "tent",
      "khemah",
      "gubahan"
    ],
    "name": "Your Studio",
    "type": "Wedding / Events",
    "sub": "Wedding / Events",
    "site": "yourwedding.my",
    "booking": "WhatsApp / Site visit",
    "systems": "WhatsApp · Google Sheets",
    "potential": 62,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "wedding & events · Shah Alam",
    "loc": "Shah Alam, MY",
    "confirm": "I found that you run a wedding / event planning business. Is that correct?",
    "funcs": [
      [
        "Enquiry response",
        "",
        "covered"
      ],
      [
        "Package quotes",
        "green",
        "live"
      ],
      [
        "Follow-up",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "amber",
        "opportunity"
      ],
      [
        "Invoicing",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "9",
        "u": "",
        "l": "enquiries answered",
        "s": "3 wedding leads"
      },
      {
        "d": "Events this month",
        "v": "5",
        "u": "",
        "l": "confirmed packages",
        "s": "2 deposits pending"
      },
      {
        "d": "Hours saved",
        "v": "11",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 54
      }
    ],
    "sug": {
      "t": "Automate wedding lead follow-up",
      "d": "Couples enquire with 3 planners at once — the fastest reply wins. AISAR answers instantly and books site visits for the best-fit dates.",
      "tag": "est. 5 hrs/month",
      "cta": "Automation queued — I'll chase wedding leads."
    },
    "team": [
      {
        "e": "💬",
        "n": "Lead Responder",
        "ch": "Instagram · WhatsApp",
        "d": "Answers package, date and budget questions — in seconds, day or night.",
        "m": "Today · 12 chats · 6 escalated"
      },
      {
        "e": "📝",
        "n": "Quote Agent",
        "ch": "WhatsApp · Form",
        "d": "Collects wedding details (date, pax, theme) and drafts package quotes.",
        "m": "This week · 4 quotes"
      },
      {
        "e": "📅",
        "n": "Event Coordinator",
        "ch": "Calendar · WhatsApp",
        "d": "Books site visits, tracks deposits and reminds you about prep milestones.",
        "m": "This month · 5 events"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Sheets · Invoicing",
        "d": "Tracks vendor payments and invoice status per event.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Lead Responder",
        "t": "Instagram · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Harga package pelamin + hantaran?\" with package link."
      },
      {
        "e": "📝",
        "n": "Quote Agent",
        "t": "1h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent package quote for Dec wedding (200 pax, theme garden)."
      },
      {
        "e": "📅",
        "n": "Event Coordinator",
        "t": "3h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Site visit booked — Sunday 11am. Reminder set for both parties."
      },
      {
        "e": "⚠️",
        "n": "Lead Responder",
        "t": "WhatsApp · 5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Couple wants custom theme + outside vendor — AISAR flagged before promising. Review?",
        "cta": "Approved — custom quote sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Lead Responder & Quote Agent use this to talk to couples.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "Shop · linked",
        "d": "Lead Responder answers DMs & comments here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads quotes & event status here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Invoicing",
        "s": "not connected",
        "d": "Unlocks automatic deposits & milestone invoice reminders.",
        "on": false,
        "cta": "Invoicing wizard will open — we'll guide you through it."
      }
    ]
  },
  "services": {
    "icon": "💼",
    "keywords": [
      "agency",
      "service",
      "services",
      "studio",
      "konsult",
      "consult",
      "design",
      "branding",
      "marketing",
      "digital",
      "freelance",
      "architect",
      "law",
      "accounting",
      "audit"
    ],
    "name": "Your Studio",
    "type": "Services / Agency",
    "sub": "Services / Agency",
    "site": "yourstudio.my",
    "booking": "Email / Calendly",
    "systems": "Notion · Google Calendar",
    "potential": 66,
    "opportunities": 4,
    "ch": [
      "Instagram",
      "Email"
    ],
    "detect": "agency · design & branding · Petaling Jaya",
    "loc": "Petaling Jaya, MY",
    "confirm": "I found that you run a design & branding agency in Petaling Jaya. Is that correct?",
    "funcs": [
      [
        "Enquiry response",
        "",
        "covered"
      ],
      [
        "Lead intake",
        "green",
        "live"
      ],
      [
        "Proposal follow-up",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "amber",
        "opportunity"
      ],
      [
        "Invoicing",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "8",
        "u": "",
        "l": "new leads",
        "s": "2 booked discovery calls"
      },
      {
        "d": "Quotes",
        "v": "3",
        "u": "",
        "l": "sent this week",
        "s": "1 awaiting reply"
      },
      {
        "d": "Hours saved",
        "v": "14",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 55
      }
    ],
    "sug": {
      "t": "Automate proposal follow-up",
      "d": "You draft quotes and chase replies manually. AISAR follows up on sent quotes automatically.",
      "tag": "est. 4 hrs/month",
      "cta": "Automation queued — I'll chase those quotes."
    },
    "team": [
      {
        "e": "🧲",
        "n": "Lead Responder",
        "ch": "Instagram · Email",
        "d": "Answers scope, pricing and availability questions — and books discovery calls.",
        "m": "Today · 8 leads · 2 booked"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Scheduling",
        "d": "Checks your calendar and schedules discovery calls without back-and-forth.",
        "m": "This week · 10 calls booked"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Sent quotes",
        "d": "Tracks sent proposals and nudges prospects at the right moment.",
        "m": "This month · 9 follow-ups"
      },
      {
        "e": "📑",
        "n": "Quote Assistant",
        "ch": "Notion · Pricing",
        "d": "Drafts first-pass quotes from your rate card and past projects.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "🧲",
        "n": "Lead Responder",
        "t": "Instagram · 1m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Do you do branding for F&B brands?\" with portfolio + case study."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "30m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked discovery call with new lead for Tue 3pm + sent invite."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Followed up quote #Q22 with a short personalised nudge."
      },
      {
        "e": "⚠️",
        "n": "Lead Responder",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Prospect asked for a discount on retainers — AISAR offered a 3-month option. Review before sending?",
        "cta": "Approved — 3-month retainer offer sent."
      }
    ],
    "conns": [
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Lead Responder answers enquiries here.",
        "on": true
      },
      {
        "e": "✉️",
        "n": "Email",
        "s": "Gmail · linked",
        "d": "Proposals and follow-up go through here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent checks availability and creates events.",
        "on": true
      },
      {
        "e": "📝",
        "n": "Notion",
        "s": "linked",
        "d": "Quote Assistant reads your rate card here.",
        "on": true
      },
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "not connected",
        "d": "Unlocks instant client chats for status updates.",
        "on": false,
        "cta": "WhatsApp connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "clinic": {
    "icon": "🏥",
    "keywords": [
      "klinik",
      "clinic",
      "doctor",
      "doktor",
      "gigi",
      "dental",
      "farmasi",
      "pharmacy",
      "physio",
      "terap",
      "therapy",
      "hospital",
      "optometri"
    ],
    "name": "Your Clinic",
    "type": "Clinic / Health",
    "sub": "Clinic / Health",
    "site": "yourclinic.my",
    "booking": "Phone / WhatsApp",
    "systems": "Clinic system · Google Sheets",
    "potential": 71,
    "opportunities": 6,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "clinic · GP & family · Johor Bahru",
    "loc": "Johor Bahru, MY",
    "confirm": "I found that you run a GP & family clinic in Johor Bahru. Is that correct?",
    "funcs": [
      [
        "Front desk",
        "",
        "covered"
      ],
      [
        "Appointments",
        "green",
        "live"
      ],
      [
        "Intake forms",
        "green",
        "live"
      ],
      [
        "Reminders",
        "green",
        "live"
      ],
      [
        "Billing",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "41",
        "u": "",
        "l": "appointments scheduled",
        "s": "12 intake forms"
      },
      {
        "d": "This week",
        "v": "86",
        "u": "",
        "l": "patients seen",
        "s": "3 no-shows prevented"
      },
      {
        "d": "Hours saved",
        "v": "25",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 68
      }
    ],
    "sug": {
      "t": "Automate appointment reminders",
      "d": "No-shows cost you hours every month. AISAR sends reminders + reschedule links automatically.",
      "tag": "est. 6 hrs/month",
      "cta": "Automation queued — I'll set up reminders."
    },
    "team": [
      {
        "e": "🩺",
        "n": "Front Desk Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers clinic hours, doctor schedules, and insurance FAQs — 24/7.",
        "m": "Today · 41 chats · 8 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Appointments",
        "d": "Books and confirms appointments, and manages the waitlist automatically.",
        "m": "This week · 86 appointments"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Patients",
        "d": "Sends reminders, post-visit check-ins, and recall messages for follow-ups.",
        "m": "This month · 210 reminders"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports · Billing",
        "d": "Prepares daily patient stats and flags billing anomalies.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "🩺",
        "n": "Front Desk Assistant",
        "t": "WhatsApp · 3m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Do you open on Sundays?\" with this week's hours."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "40m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked appointment for Azman (check-up) Thu 10am + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent post-visit check-in to 23 patients from yesterday."
      },
      {
        "e": "⚠️",
        "n": "Front Desk Assistant",
        "t": "6h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Patient asked about pricing for a procedure — AISAR offered a call-back. Review before sending?",
        "cta": "Approved — call-back scheduled."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Front Desk Assistant & Follow-up talk to patients here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Front Desk Assistant can make call-backs here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages appointments here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads appointment stats here.",
        "on": true
      },
      {
        "e": "🏥",
        "n": "Clinic system",
        "s": "not connected",
        "d": "Unlocks automatic patient records sync.",
        "on": false,
        "cta": "Clinic system connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "salon": {
    "icon": "💇",
    "keywords": [
      "salon",
      "salun",
      "dandan",
      "rambut",
      "hair",
      "beauty",
      "spa",
      "kuku",
      "nails",
      "lash",
      "makeup",
      "mekap"
    ],
    "name": "Your Salon",
    "type": "Salon / Beauty",
    "sub": "Salon / Beauty",
    "site": "yoursalon.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Calendar · POS",
    "potential": 60,
    "opportunities": 4,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "salon & beauty · Shah Alam",
    "loc": "Shah Alam, MY",
    "confirm": "I found that you run a salon/beauty business in Shah Alam. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Bookings",
        "green",
        "live"
      ],
      [
        "Reminders",
        "green",
        "live"
      ],
      [
        "Product retail",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & rebooking",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "9",
        "u": "",
        "l": "appointments",
        "s": "2 walk-in slots left"
      },
      {
        "d": "New clients",
        "v": "14",
        "u": "",
        "l": "this week",
        "s": "5 via Instagram"
      },
      {
        "d": "Hours saved",
        "v": "16",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 57
      }
    ],
    "sug": {
      "t": "Automate booking reminders",
      "d": "No-shows and last-minute cancellations eat your schedule. AISAR sends reminders + fill-from-waitlist automatically.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll handle reminders + waitlist."
    },
    "team": [
      {
        "e": "💬",
        "n": "Reception Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers service prices, availability, and stylist questions — 24/7.",
        "m": "Today · 9 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Appointments",
        "d": "Books services, manages waitlist, and sends confirmations.",
        "m": "This week · 22 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past clients",
        "d": "Sends rebooking nudges and after-care messages to keep clients coming back.",
        "m": "This month · 31 rebookings"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Tracks product stock and prepares your weekly client report.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Reception Assistant",
        "t": "WhatsApp · 5m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa untuk rebond panjang?\" with price list + stylist availability."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked colour + treatment for Aina, Sat 11am + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent rebooking nudge to 8 clients whose last visit was 6+ weeks ago."
      },
      {
        "e": "⚠️",
        "n": "Reception Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Client asked about bridal package pricing — AISAR offered a consultation call. Review before sending?",
        "cta": "Approved — consultation call scheduled."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Reception Assistant & Follow-up talk to clients here.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Booking Agent receives booking DMs here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages appointments here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads client & stock data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks product retail automation + daily sales reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "gym": {
    "icon": "🏋️",
    "keywords": [
      "gym",
      "fitness",
      "futsal",
      "badminton",
      "yoga",
      "pilates",
      "crossfit",
      "workout",
      "sport",
      "sukan",
      "swim",
      "swimming",
      "bootcamp"
    ],
    "name": "Your Gym",
    "type": "Gym / Fitness",
    "sub": "Gym / Fitness",
    "site": "yourgym.my",
    "booking": "App / WhatsApp",
    "systems": "Google Sheets · App",
    "potential": 63,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "gym & fitness · Petaling Jaya",
    "loc": "Petaling Jaya, MY",
    "confirm": "I found that you run a gym/fitness studio in Petaling Jaya. Is that correct?",
    "funcs": [
      [
        "Front desk",
        "",
        "covered"
      ],
      [
        "Class bookings",
        "green",
        "live"
      ],
      [
        "Member enquiries",
        "green",
        "live"
      ],
      [
        "Renewals",
        "amber",
        "opportunity"
      ],
      [
        "Trial sign-ups",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "23",
        "u": "",
        "l": "check-ins",
        "s": "3 class waitlists active"
      },
      {
        "d": "New leads",
        "v": "11",
        "u": "",
        "l": "this week",
        "s": "4 trial passes booked"
      },
      {
        "d": "Hours saved",
        "v": "15",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 60
      }
    ],
    "sug": {
      "t": "Automate class schedule answers",
      "d": "Members ask \"is there a slot tonight?\" every day. AISAR answers with live availability + waitlist signup.",
      "tag": "est. 5 hrs/month",
      "cta": "Automation queued — I'll handle class schedule answers."
    },
    "team": [
      {
        "e": "💬",
        "n": "Front Desk Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers membership, class schedule, and pricing questions — 24/7.",
        "m": "Today · 23 chats · 5 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Classes · Waitlist",
        "d": "Books classes, manages waitlists, and sends class reminders.",
        "m": "This week · 48 class bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Members",
        "d": "Sends renewal reminders and re-engages lapsed members.",
        "m": "This month · 14 renewals saved"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports",
        "d": "Prepares daily attendance and flags under-booked classes.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Front Desk Assistant",
        "t": "WhatsApp · 4m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Ada slot kelas malam ni?\" with live availability + waitlist link."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "50m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked HIT class for Amir, 7pm + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent renewal reminder to 6 members expiring this week."
      },
      {
        "e": "⚠️",
        "n": "Front Desk Assistant",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Prospect asked about corporate memberships — AISAR offered a call-back. Review before sending?",
        "cta": "Approved — call-back scheduled."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Front Desk Assistant & Follow-up talk to members here.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Trial sign-ups come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages class schedules here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads attendance here.",
        "on": true
      },
      {
        "e": "💳",
        "n": "Member app / Payment",
        "s": "not connected",
        "d": "Unlocks automatic renewals & payment reminders.",
        "on": false,
        "cta": "Payment connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "tuition": {
    "icon": "📚",
    "keywords": [
      "tuition",
      "tutor",
      "tuto",
      "pusat tuisyen",
      "academy",
      "akademi",
      "kelas",
      "belajar",
      "music school",
      "coding class",
      "mengaji",
      "tahfiz",
      "daycare",
      "taska",
      "kindergarten",
      "tadika"
    ],
    "name": "Your Tuition Centre",
    "type": "Tuition / Education",
    "sub": "Tuition / Education",
    "site": "yourtution.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · Excel",
    "potential": 59,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "tuition & education · Kuala Lumpur",
    "loc": "Kuala Lumpur, MY",
    "confirm": "I found that you run a tuition/education centre in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Parent enquiries",
        "",
        "covered"
      ],
      [
        "Class schedules",
        "green",
        "live"
      ],
      [
        "Fee reminders",
        "green",
        "live"
      ],
      [
        "Attendance",
        "amber",
        "opportunity"
      ],
      [
        "Progress reports",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "18",
        "u": "",
        "l": "messages from parents",
        "s": "5 new enquiries"
      },
      {
        "d": "New students",
        "v": "5",
        "u": "",
        "l": "enquiries this week",
        "s": "2 trials booked"
      },
      {
        "d": "Hours saved",
        "v": "12",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 52
      }
    ],
    "sug": {
      "t": "Automate fee reminders",
      "d": "You chase fees every month. AISAR sends polite reminders + receipts automatically.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll handle fee reminders."
    },
    "team": [
      {
        "e": "💬",
        "n": "Parent Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers class schedules, fees, and location questions — 24/7.",
        "m": "Today · 18 chats · 3 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Classes · Trials",
        "d": "Books trial classes and manages student slots.",
        "m": "This week · 9 trials booked"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Parents",
        "d": "Sends fee reminders, homework updates, and progress nudges.",
        "m": "This month · 42 reminders sent"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Attendance · Reports",
        "d": "Tracks attendance and prepares monthly class reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Parent Assistant",
        "t": "WhatsApp · 3m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa yuran untuk darjah 4?\" with fee list + class times."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked trial class for Aiman, Sat 10am Mathematics."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent fee reminder to 12 parents (polite, with receipt attached)."
      },
      {
        "e": "⚠️",
        "n": "Parent Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Parent asked about discount for 2 siblings — AISAR offered 10%. Review before sending?",
        "cta": "Approved — 10% sibling discount offered."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Parent Assistant & Follow-up talk to parents here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Enquiries by call route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages class schedules here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads attendance & fees here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Accounting",
        "s": "not connected",
        "d": "Unlocks automatic receipts & monthly statements.",
        "on": false,
        "cta": "Accounting connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "laundry": {
    "icon": "🧺",
    "keywords": [
      "dobi",
      "laundry",
      "basuh",
      "dry clean",
      "dry cleaning",
      "iron",
      "seterika"
    ],
    "name": "Your Laundry",
    "type": "Laundry / Dobi",
    "sub": "Laundry / Dobi",
    "site": "yourlaundry.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Kuala Lumpur, MY",
    "potential": 57,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "laundry & dobi · Kuala Lumpur",
    "confirm": "I found that you run a laundry/dobi service in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Order intake",
        "green",
        "live"
      ],
      [
        "Status updates",
        "green",
        "live"
      ],
      [
        "Pickup & delivery",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & repeat",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "26",
        "u": "",
        "l": "orders collected",
        "s": "5 pickup requests"
      },
      {
        "d": "This week",
        "v": "154",
        "u": " kg",
        "l": "laundry processed",
        "s": "12 new customers"
      },
      {
        "d": "Hours saved",
        "v": "14",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 53
      }
    ],
    "sug": {
      "t": "Automate order status updates",
      "d": "Customers ask \"dah siap?\" every day. AISAR sends status updates + pickup reminders automatically.",
      "tag": "est. 2 hrs/month",
      "cta": "Automation queued — I'll set up status updates."
    },
    "team": [
      {
        "e": "💬",
        "n": "Order Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers pricing, services, and pickup questions — 24/7.",
        "m": "Today · 26 chats · 4 escalated"
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "ch": "Pickup · Drop-off",
        "d": "Arranges pickup & delivery slots and sends driver updates.",
        "m": "This week · 18 pickups"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past customers",
        "d": "Sends rebooking nudges and loyalty offers to regulars.",
        "m": "This month · 21 rebookings"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports",
        "d": "Tracks daily volume and prepares your weekly report.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Order Assistant",
        "t": "WhatsApp · 3m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa harga basuh baju?\" with price list + today pickup slot."
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Confirmed pickup for 2 bags, 6pm — driver notified."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent \"your laundry is ready for pickup\" to 9 customers."
      },
      {
        "e": "⚠️",
        "n": "Order Assistant",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer complained about a missing item — AISAR apologised and offered 20% off next order.",
        "cta": "Approved — 20% voucher sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Order Assistant & Follow-up talk to customers here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Pickup requests come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Delivery Coordinator schedules pickups here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads orders here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks daily revenue reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "auto": {
    "icon": "🔧",
    "keywords": [
      "bengkel",
      "kereta",
      "mekanik",
      "tayar",
      "workshop",
      "servis kereta",
      "sparepart",
      "minyak hitam",
      "pomen"
    ],
    "name": "Your Workshop",
    "type": "Auto Workshop / Bengkel",
    "sub": "Auto Workshop / Bengkel",
    "site": "yourworkshop.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Shah Alam, MY",
    "potential": 64,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "auto workshop & bengkel · Shah Alam",
    "confirm": "I found that you run a car workshop/bengkel in Shah Alam. Is that correct?",
    "funcs": [
      [
        "Customer enquiries",
        "",
        "covered"
      ],
      [
        "Service bookings",
        "green",
        "live"
      ],
      [
        "Service reminders",
        "green",
        "live"
      ],
      [
        "Parts & inventory",
        "amber",
        "opportunity"
      ],
      [
        "Invoices",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "8",
        "u": "",
        "l": "cars in workshop",
        "s": "2 ready for pickup"
      },
      {
        "d": "This week",
        "v": "31",
        "u": "",
        "l": "vehicles serviced",
        "s": "4 new regulars"
      },
      {
        "d": "Hours saved",
        "v": "13",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 59
      }
    ],
    "sug": {
      "t": "Automate service reminders",
      "d": "Customers forget servicing. AISAR reminds them when their car is due + books the slot automatically.",
      "tag": "est. 4 hrs/month",
      "cta": "Automation queued — I'll set up service reminders."
    },
    "team": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers service pricing, tyre sizes, and booking questions — 24/7.",
        "m": "Today · 8 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Appointments",
        "d": "Books service slots and manages the workshop schedule.",
        "m": "This week · 22 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Service due",
        "d": "Tracks service intervals and reminds customers when their car is due.",
        "m": "This month · 31 reminders"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Parts · Reports",
        "d": "Watches parts inventory and prepares daily workshop reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa servis minyak hitam?\" with package prices + available slots."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "40m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked full service for Proton Saga, Thu 10am + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 6 customers that their car is due for service this month."
      },
      {
        "e": "⚠️",
        "n": "Service Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer asked about brake pad replacement pricing — AISAR offered a call-back quote.",
        "cta": "Approved — quote call-back scheduled."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Service Assistant & Follow-up talk to customers here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Service bookings by call route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages slots here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads parts & jobs here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks automatic invoices & GST-ready reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "petcare": {
    "icon": "🐾",
    "keywords": [
      "pet",
      "petshop",
      "pet shop",
      "groom",
      "grooming",
      "anjing",
      "kucing",
      "haiwan",
      "vet",
      "klinik haiwan",
      "boarding"
    ],
    "name": "Your Pet Shop",
    "type": "Pet Care / Grooming",
    "sub": "Pet Care / Grooming",
    "site": "yourpetshop.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Petaling Jaya, MY",
    "potential": 61,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "pet care & grooming · Petaling Jaya",
    "confirm": "I found that you run a pet care/grooming business in Petaling Jaya. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Grooming bookings",
        "green",
        "live"
      ],
      [
        "Reminders",
        "green",
        "live"
      ],
      [
        "Product retail",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & rebooking",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "6",
        "u": "",
        "l": "grooming appointments",
        "s": "2 boarding check-ins"
      },
      {
        "d": "New pets",
        "v": "9",
        "u": "",
        "l": "this week",
        "s": "4 via Instagram"
      },
      {
        "d": "Hours saved",
        "v": "11",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 55
      }
    ],
    "sug": {
      "t": "Automate grooming reminders",
      "d": "Owners forget appointments — and no-shows cost you. AISAR sends reminders + rebooking nudges automatically.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll handle grooming reminders."
    },
    "team": [
      {
        "e": "💬",
        "n": "Pet Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers grooming prices, breed questions, and boarding availability — 24/7.",
        "m": "Today · 9 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Appointments",
        "d": "Books grooming slots and manages boarding reservations.",
        "m": "This week · 18 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past clients",
        "d": "Sends rebooking nudges and after-care messages for pets.",
        "m": "This month · 26 rebookings"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Tracks pet food stock and prepares weekly client reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Pet Assistant",
        "t": "WhatsApp · 4m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa harga groom kucing?\" with price list + groomer availability."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked full groom for Miko (shih tzu), Sat 10am + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent rebooking nudge to 7 pet owners due for their next groom."
      },
      {
        "e": "⚠️",
        "n": "Pet Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Owner asked about boarding during Raya — AISAR offered a hold-slot.",
        "cta": "Approved — boarding slot held."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Pet Assistant & Follow-up talk to owners here.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Grooming bookings come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages appointments here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads client & stock data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks product retail automation + sales reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "florist": {
    "icon": "💐",
    "keywords": [
      "bunga",
      "florist",
      "floral",
      "bouquet",
      "taman bunga"
    ],
    "name": "Your Florist",
    "type": "Florist / Gifting",
    "sub": "Florist / Gifting",
    "site": "yourflorist.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Kuala Lumpur, MY",
    "potential": 56,
    "opportunities": 4,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "florist & gifting · Kuala Lumpur",
    "confirm": "I found that you run a florist/gifting business in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Order intake",
        "green",
        "live"
      ],
      [
        "Delivery coordination",
        "green",
        "live"
      ],
      [
        "Seasonal campaigns",
        "amber",
        "opportunity"
      ],
      [
        "Same-day specials",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "14",
        "u": "",
        "l": "orders taken",
        "s": "6 out for delivery"
      },
      {
        "d": "This week",
        "v": "89",
        "u": "",
        "l": "bouquets delivered",
        "s": "12 repeat gifters"
      },
      {
        "d": "Hours saved",
        "v": "10",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 50
      }
    ],
    "sug": {
      "t": "Automate delivery updates",
      "d": "Customers always ask \"sampai dah?\". AISAR sends delivery confirmations + photos automatically.",
      "tag": "est. 2 hrs/month",
      "cta": "Automation queued — I'll set up delivery updates."
    },
    "team": [
      {
        "e": "💬",
        "n": "Florist Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers bouquet prices, delivery areas, and same-day orders — 24/7.",
        "m": "Today · 14 chats · 3 escalated"
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "ch": "Orders · Routes",
        "d": "Schedules deliveries and sends live status to customers.",
        "m": "This week · 89 deliveries"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Anniversaries · Birthdays",
        "d": "Remembers occasions and suggests gifting moments to past customers.",
        "m": "This month · 18 occasions"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Tracks flower stock and seasonal demand.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Florist Assistant",
        "t": "Instagram · 1m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Ada bouquet bawah RM100?\" with today's options + delivery time."
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Delivered anniversary bouquet — sent photo + confirmation to customer."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 5 past customers that their mum's birthday is next week."
      },
      {
        "e": "⚠️",
        "n": "Florist Assistant",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer needs urgent same-day delivery — driver unavailable. AISAR suggested express option.",
        "cta": "Approved — express delivery arranged."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Florist Assistant & Follow-up talk to customers here.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Orders come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Delivery Coordinator plans routes here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads orders & stock here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks daily sales + refund handling.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "property": {
    "icon": "🏠",
    "keywords": [
      "hartanah",
      "property",
      "real estate",
      "ejen",
      "landlord",
      "tuan tanah",
      "lelong",
      "listing"
    ],
    "name": "Your Agency",
    "type": "Real Estate / Property",
    "sub": "Real Estate / Property",
    "site": "youragency.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · CRM",
    "loc": "Kuala Lumpur, MY",
    "potential": 65,
    "opportunities": 6,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "real estate agency · Kuala Lumpur",
    "confirm": "I found that you run a real estate/property agency in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Lead response",
        "",
        "covered"
      ],
      [
        "Viewing scheduling",
        "green",
        "live"
      ],
      [
        "Listing updates",
        "green",
        "live"
      ],
      [
        "Buyer qualification",
        "amber",
        "opportunity"
      ],
      [
        "Follow-up cadence",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "12",
        "u": "",
        "l": "new leads",
        "s": "3 viewings booked"
      },
      {
        "d": "This week",
        "v": "27",
        "u": "",
        "l": "enquiries",
        "s": "9 active listings"
      },
      {
        "d": "Hours saved",
        "v": "16",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 61
      }
    ],
    "sug": {
      "t": "Automate first-reply speed",
      "d": "The first agent to reply wins the deal. AISAR answers enquiries instantly + books viewings.",
      "tag": "est. 5 hrs/month",
      "cta": "Automation queued — I'll handle lead response."
    },
    "team": [
      {
        "e": "🧲",
        "n": "Lead Responder",
        "ch": "WhatsApp · Phone",
        "d": "Answers property questions, pricing, and viewing availability — 24/7.",
        "m": "Today · 12 leads · 3 booked"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Viewings",
        "d": "Books viewing slots and sends confirmations + location pins.",
        "m": "This week · 9 viewings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Buyers · Sellers",
        "d": "Nudges interested buyers and checks in with sellers.",
        "m": "This month · 24 follow-ups"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "CRM · Reports",
        "d": "Tracks lead pipeline and prepares weekly reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "🧲",
        "n": "Lead Responder",
        "t": "WhatsApp · 1m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Ada unit bawah 500k dekat LRT?\" with 3 matching listings + viewing link."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "30m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked viewing for unit B-12, Sat 11am + sent location pin."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Followed up 4 buyers from yesterday's open house."
      },
      {
        "e": "⚠️",
        "n": "Lead Responder",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Buyer asked about negotiation on asking price — AISAR drafted a polite response.",
        "cta": "Approved — response sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Lead Responder & Follow-up talk to clients here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Call enquiries route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages viewings here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads listings & pipeline here.",
        "on": true
      },
      {
        "e": "🗂️",
        "n": "CRM system",
        "s": "not connected",
        "d": "Unlocks full pipeline tracking + auto reports.",
        "on": false,
        "cta": "CRM connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "cleaning": {
    "icon": "🧽",
    "keywords": [
      "cleaning",
      "cuci",
      "pembersihan",
      "maid",
      "domestik",
      "disinfect"
    ],
    "name": "Your Cleaning Co",
    "type": "Cleaning Services",
    "sub": "Cleaning Services",
    "site": "yourcleaning.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets",
    "loc": "Selangor, MY",
    "potential": 58,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "cleaning services · Selangor",
    "confirm": "I found that you run a cleaning services business in Selangor. Is that correct?",
    "funcs": [
      [
        "Customer enquiries",
        "",
        "covered"
      ],
      [
        "Quote requests",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "green",
        "live"
      ],
      [
        "Recurring bookings",
        "amber",
        "opportunity"
      ],
      [
        "Team dispatch",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "7",
        "u": "",
        "l": "jobs scheduled",
        "s": "3 quotes sent"
      },
      {
        "d": "This week",
        "v": "19",
        "u": "",
        "l": "bookings",
        "s": "5 recurring clients"
      },
      {
        "d": "Hours saved",
        "v": "12",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 54
      }
    ],
    "sug": {
      "t": "Automate quote requests",
      "d": "AISAR collects details (type, size, frequency) and sends pricing quotes instantly — no back-and-forth.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll set up instant quotes."
    },
    "team": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers service areas, pricing, and availability — 24/7.",
        "m": "Today · 7 chats · 1 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Jobs",
        "d": "Schedules jobs and assigns the right crew.",
        "m": "This week · 19 jobs"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Recurring clients",
        "d": "Reminds recurring clients and nudges for monthly bookings.",
        "m": "This month · 12 renewals"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports · Dispatch",
        "d": "Prepares crew schedules and daily job reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa untuk cuci rumah 3 bilik?\" with instant quote + slots."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked deep-clean for 3-room condo, Thu 9am + crew assigned."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 5 recurring clients their monthly clean is due."
      },
      {
        "e": "⚠️",
        "n": "Service Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Client asked about monthly discount packages — AISAR offered a 3-month plan.",
        "cta": "Approved — 3-month plan offered."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Service Assistant & Follow-up talk to clients here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Job enquiries route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent schedules jobs here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads job data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Invoicing",
        "s": "not connected",
        "d": "Unlocks automatic invoices & monthly billing.",
        "on": false,
        "cta": "Invoicing connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "minimart": {
    "name": "Your Minimart",
    "type": "Minimart / Grocery",
    "icon": "🏪",
    "loc": "Kuala Lumpur, MY",
    "potential": 58,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "minimart & grocery · Kuala Lumpur",
    "confirm": "I found that you run a minimart/grocery shop in Kuala Lumpur. Is that correct?",
    "keywords": [
      "minimart",
      "kedai runcit",
      "runcit",
      "grocery",
      "serbaneka",
      "stor runcit"
    ],
    "sub": "Minimart / Grocery",
    "site": "yourbusiness.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets",
    "funcs": [
      [
        "Customer enquiries",
        "",
        "covered"
      ],
      [
        "Follow-up",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "green",
        "live"
      ],
      [
        "Reports",
        "amber",
        "opportunity"
      ],
      [
        "Invoicing",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "9",
        "u": "",
        "l": "customer conversations",
        "s": "2 need you"
      },
      {
        "d": "New enquiries",
        "v": "14",
        "u": "",
        "l": "this week",
        "s": "via WhatsApp + Phone"
      },
      {
        "d": "Hours saved",
        "v": "11",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 48
      }
    ],
    "sug": {
      "t": "Automate your common questions",
      "d": "Your customers ask the same things every day. AISAR answers them instantly — in your voice.",
      "tag": "est. 2 hrs/month",
      "cta": "Automation queued — I'll set up the Customer Assistant."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers your FAQs instantly — hours, pricing, availability — 24/7.",
        "m": "Today · 9 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar",
        "d": "Schedules appointments and sends confirmations automatically.",
        "m": "This week · 6 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past customers",
        "d": "Follows up enquiries and past customers automatically.",
        "m": "This month · 18 follow-ups"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports",
        "d": "Prepares a simple weekly summary of everything that happened.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"What are your opening hours?\" instantly."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked an appointment + sent confirmation."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Followed up 2 enquiries from yesterday."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer asked about special pricing — AISAR drafted a reply.",
        "cta": "Approved — reply sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant talks to customers here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Enquiries by call route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent checks availability here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads your data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Accounting",
        "s": "not connected",
        "d": "Unlocks invoicing automation.",
        "on": false,
        "cta": "Accounting connection wizard will open — we'll guide you through it."
      }
    ]
  },
  "generic": {
    "icon": "🏪",
    "keywords": [],
    "name": "Your Business",
    "type": "Small Business",
    "sub": "Small Business",
    "site": "yourbusiness.com",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets",
    "potential": 55,
    "opportunities": 3,
    "ch": [
      "WhatsApp",
      "Email"
    ],
    "detect": "small business · services",
    "loc": "Malaysia",
    "confirm": "I found what your business is about. Is this correct?",
    "funcs": [
      [
        "Customer enquiries",
        "",
        "covered"
      ],
      [
        "Follow-up",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "amber",
        "opportunity"
      ],
      [
        "Reports",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "9",
        "u": "",
        "l": "customer conversations",
        "s": "2 need you"
      },
      {
        "d": "New enquiries",
        "v": "14",
        "u": "",
        "l": "this week",
        "s": "via WhatsApp + Email"
      },
      {
        "d": "Hours saved",
        "v": "11",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 48
      }
    ],
    "sug": {
      "t": "Automate your common questions",
      "d": "Your customers ask the same things every day. AISAR answers them instantly — in your voice.",
      "tag": "est. 2 hrs/month",
      "cta": "Automation queued — I'll set up the Customer Assistant."
    },
    "team": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "ch": "WhatsApp · Email",
        "d": "Answers your FAQs instantly — hours, pricing, availability — 24/7.",
        "m": "Today · 9 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar",
        "d": "Schedules appointments and sends confirmations automatically.",
        "m": "This week · 6 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past customers",
        "d": "Follows up enquiries and past customers automatically.",
        "m": "This month · 18 follow-ups"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports",
        "d": "Prepares a simple weekly summary of everything that happened.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Customer Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"What are your opening hours?\" instantly."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked an appointment + sent confirmation."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Followed up 2 enquiries from yesterday."
      },
      {
        "e": "⚠️",
        "n": "Customer Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer asked about special pricing — AISAR drafted a reply. Review before sending?",
        "cta": "Approved — reply sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Customer Assistant talks to customers here.",
        "on": true
      },
      {
        "e": "✉️",
        "n": "Email",
        "s": "Gmail · linked",
        "d": "Follow-ups and documents go through here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent checks availability here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads your data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Accounting",
        "s": "not connected",
        "d": "Unlocks invoicing automation.",
        "on": false,
        "cta": "Accounting connection wizard will open — we'll guide you through it."
      }
    ]
  }
};
