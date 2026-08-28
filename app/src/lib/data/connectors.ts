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
    "n": "Google (Sheets & Calendar)",
    "e": "📊",
    "tier": "T1",
    "method": "oauth",
    "flow": "Google OAuth — popup login, sync ke Sheets/Calendar",
    "scope": [
      "baca stock/order",
      "auto-import booking",
      "hantar jadual"
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
