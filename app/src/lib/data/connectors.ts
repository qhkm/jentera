/* Ported from the old engine (KV_CONNECTORS).
   Data only — hand-edit directly; there's no generator anymore. */

import type { Connector } from '../types';

export const CONNECTORS: Record<string, Connector> = {
  "whatsapp": {
    "n": "WhatsApp",
    "e": "💬",
    "tier": "T1",
    "method": "oauth",
    "flow": "Meta Embedded Signup — login FB/Meta, setup WhatsApp Cloud API automatik (takde API key)",
    "scope": [
      "reply pelanggan",
      "hantar reminder",
      "hantar receipt",
      "auto-follow-up"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "PH"
    ],
    "meta": true
  },
  "instagram": {
    "n": "Instagram",
    "e": "📸",
    "tier": "T1",
    "method": "oauth",
    "flow": "Meta Business Login — 1 klik connect, perlu FB Page + IG Business",
    "scope": [
      "jawab DM",
      "baca komen",
      "hantar promo"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "VN",
      "PH"
    ],
    "meta": true
  },
  "bukku": {
    "n": "Bukku",
    "e": "\ud83d\udcd2",
    "tier": "T2",
    "method": "link",
    "flow": "Turn on API access in your own Bukku control panel and paste the token \u2014 no dealer, no install",
    "category": "accounting",
    "description": {
      "en": "Ask who has not paid you. Jentera reads your invoices and contacts; it never writes to your books.",
      "bm": "Tanya siapa belum bayar. Jentera membaca invois dan kenalan anda; ia tidak menulis apa-apa ke dalam akaun anda."
    },
    "scope": [
      "read unpaid and overdue invoices",
      "read customer contacts"
    ],
    "countries": [
      "MY"
    ]
  },
  "telegram": {
    "n": "Telegram",
    "e": "✈️",
    "tier": "T2",
    "method": "bss",
    "flow": "Guided private-agent pairing — Jentera handles the token, webhook, and owner-chat lock securely",
    "scope": [
      "chat with your business agent",
      "research and planning",
      "business memory",
      "internal task updates"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "VN",
      "PH"
    ]
  },
  "google": {
    "n": "Google Calendar",
    "e": "📅",
    "category": "google",
    "availability": "pilot",
    "description": {
      "en": "Check your primary calendar and prepare new events. You review every event before it is added; automatic booking is not available yet. Google permission verification is pending.",
      "bm": "Semak kalendar utama dan sediakan acara baharu. Anda menyemak setiap acara sebelum ia ditambah; tempahan automatik belum tersedia. Pengesahan kebenaran Google masih menunggu."
    },
    "tier": "T1",
    "method": "oauth",
    "flow": "Google OAuth — explicit Calendar grant; new events require owner approval",
    "scope": [
      "check calendar availability",
      "read upcoming events",
      "draft events for approval"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "VN",
      "PH"
    ]
  },
  "gmail": {
    "n": "Gmail", "e": "✉️", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned — no authorisation flow available", "scope": [],
    "description": {
      "en": "Planned: summarise email and prepare replies for your approval. No mailbox access is available yet.",
      "bm": "Dirancang: ringkaskan e-mel dan sediakan balasan untuk kelulusan anda. Akses peti masuk belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "google-drive": {
    "n": "Google Drive", "e": "🗂️", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned — no authorisation flow available", "scope": [],
    "description": {
      "en": "Planned: work with files you choose to share. Connecting your Drive is not available yet.",
      "bm": "Dirancang: bekerja dengan fail yang anda pilih untuk dikongsi. Sambungan Drive belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "google-sheets": {
    "n": "Google Sheets", "e": "📊", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned — no authorisation flow available", "scope": [],
    "description": {
      "en": "Planned: analyse spreadsheets and prepare updates. Direct Sheets access is not available yet.",
      "bm": "Dirancang: analisis hamparan dan sediakan kemas kini. Akses terus ke Sheets belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "google-docs": {
    "n": "Google Docs", "e": "📝", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned — no authorisation flow available", "scope": [],
    "description": {
      "en": "Planned: draft and review documents in Google Docs. This connection is not available yet.",
      "bm": "Dirancang: draf dan semak dokumen dalam Google Docs. Sambungan ini belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "google-slides": {
    "n": "Google Slides", "e": "📽️", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned — no authorisation flow available", "scope": [],
    "description": {
      "en": "Planned: prepare and review Google Slides. This connection is not available yet.",
      "bm": "Dirancang: sediakan dan semak Google Slides. Sambungan ini belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "google-contacts": {
    "n": "Google Contacts", "e": "👥", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned for a later phase — no authorisation flow available", "scope": [],
    "description": {
      "en": "For a later phase: help organise contacts you permit Jentera to access. Not available yet.",
      "bm": "Untuk fasa kemudian: bantu susun kenalan yang anda benarkan Jentera akses. Belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "google-tasks": {
    "n": "Google Tasks", "e": "✅", "tier": "T1", "method": "oauth",
    "category": "google", "availability": "planned",
    "flow": "Planned for a later phase — no authorisation flow available", "scope": [],
    "description": {
      "en": "For a later phase: prepare and organise your Google Tasks. Not available yet.",
      "bm": "Untuk fasa kemudian: sediakan dan susun Google Tasks anda. Belum tersedia."
    },
    "countries": ["MY", "ID", "SG", "TH", "VN", "PH"]
  },
  "billplz": {
    "n": "Billplz",
    "e": "🧾",
    "tier": "T2",
    "method": "link",
    "flow": "Payment link — jana link/QR, tiada integrasi rumit; webhook kita pegang",
    "scope": [
      "jana payment link",
      "auto-receipt",
      "reminder bayaran"
    ],
    "countries": [
      "MY"
    ],
    "fpga": true
  },
  "senangpay": {
    "n": "senangPay (DOKU)",
    "e": "💳",
    "tier": "T2",
    "method": "link",
    "flow": "Payment link + QR — bayar via FPX, e-wallet, kad",
    "scope": [
      "payment link",
      "auto-receipt"
    ],
    "countries": [
      "MY"
    ],
    "fpga": true
  },
  "shopee": {
    "n": "Shopee",
    "e": "🛒",
    "tier": "T1",
    "method": "oauth",
    "flow": "Shopee Open Platform — seller authorize, kita daftar app sekali",
    "scope": [
      "sync order",
      "update tracking",
      "jawab chat"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "PH"
    ],
    "marketplace": true
  },
  "lazada": {
    "n": "Lazada",
    "e": "🛍️",
    "tier": "T1",
    "method": "oauth",
    "flow": "Lazada Open Platform — seller authorize",
    "scope": [
      "sync order",
      "update status"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "PH"
    ],
    "marketplace": true
  },
  "tiktokshop": {
    "n": "TikTok Shop",
    "e": "🎵",
    "tier": "T1",
    "method": "oauth",
    "flow": "TikTok Shop Seller API — authorize, kita daftar app",
    "scope": [
      "sync order",
      "auto-reply chat"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "VN",
      "PH"
    ],
    "marketplace": true
  },
  "grab": {
    "n": "GrabFood",
    "e": "🛵",
    "tier": "T3",
    "method": "file",
    "flow": "Email-to-parse atau CSV export mingguan",
    "scope": [
      "sync order",
      "track revenue"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "PH",
      "VN"
    ],
    "delivery": true
  },
  "foodpanda": {
    "n": "foodpanda",
    "e": "🍱",
    "tier": "T3",
    "method": "file",
    "flow": "Email-to-parse atau CSV export mingguan",
    "scope": [
      "sync order",
      "track revenue"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH"
    ],
    "delivery": true
  },
  "qashier": {
    "n": "Qashier POS",
    "e": "🧾",
    "tier": "T3",
    "method": "file",
    "flow": "CSV export atau Google Sheets sync (POS takde API terbuka)",
    "scope": [
      "sync sales",
      "inventory",
      "P&L report"
    ],
    "countries": [
      "MY",
      "SG"
    ],
    "pos": true
  },
  "storehub": {
    "n": "StoreHub POS",
    "e": "🏪",
    "tier": "T3",
    "method": "file",
    "flow": "CSV export / Sheets sync — 20k+ kedai MY guna",
    "scope": [
      "sync sales",
      "inventory",
      "customer list"
    ],
    "countries": [
      "MY",
      "SG"
    ],
    "pos": true
  },
  "lalamove": {
    "n": "Lalamove",
    "e": "🚚",
    "tier": "T2",
    "method": "link",
    "flow": "Link-based — jana pickup request dari order, takde API key",
    "scope": [
      "auto-booking delivery",
      "track status"
    ],
    "countries": [
      "MY",
      "ID",
      "SG",
      "TH",
      "PH",
      "VN"
    ],
    "delivery": true
  },
  "gdex": {
    "n": "GDEX",
    "e": "📦",
    "tier": "T2",
    "method": "link",
    "flow": "Courier link + webhook — dropoff request dari order",
    "scope": [
      "auto-shipping label",
      "track status"
    ],
    "countries": [
      "MY"
    ],
    "courier": true,
    "e-invoice": false
  },
  "duitnow": {
    "n": "DuitNow QR",
    "e": "🔗",
    "tier": "T2",
    "method": "link",
    "flow": "QR jana terus — bayaran masuk, kita webhook",
    "scope": [
      "QR payment",
      "auto-receipt"
    ],
    "countries": [
      "MY"
    ]
  },
  "lhdn": {
    "n": "LHDN e-Invoice",
    "e": "🧾",
    "tier": "T4",
    "method": "bss",
    "flow": "Kita pegang credential/dig prepaid — customer tak nampak; compliance auto",
    "scope": [
      "auto-e-invoice",
      "compliance"
    ],
    "countries": [
      "MY"
    ],
    "regulated": true
  }
};
