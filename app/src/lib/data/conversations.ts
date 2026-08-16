/* Ported verbatim from biz-engine.js. Data only — regenerate rather than hand-edit. */

export const CHAT_TEMPLATES: Record<string, string[]> = {
  "Customer Assistant": [
    "Hantar menu terkini 📄",
    "Maklumkan waktu operasi 🕐",
    "Promo minggu ini 🎉"
  ],
  "Booking Agent": [
    "Confirm booking 📅",
    "Tanya tarikh alternatif 🔁",
    "Hantar reminder ⏰"
  ],
  "Follow-up": [
    "Hantar promo peribadi 🎁",
    "Tanya maklum balas 💬",
    "Ucap terima kasih 🙏"
  ],
  "Ops Assistant": [
    "Minta weekly report 📊",
    "Auto-order stok 📦",
    "Update supplier 🔄"
  ]
};

export interface TeamChannel { label: string; desc: string; tpl: string[] }
export const TEAM_CHANNELS: Record<string, TeamChannel> = {
  "#pasukan": {
    "label": "pasukan",
    "desc": "ruang kolaborasi semua agent",
    "tpl": [
      "Apa status order hari ni? 📊",
      "@Follow-up: hantar reminder promo minggu ni 🎁",
      "@Ops Assistant: siapkan weekly report 📈",
      "Ada apa-apa escalation yang perlu aku semak? ⚠️"
    ]
  },
  "#escalations": {
    "label": "escalations",
    "desc": "auto-log dari ⚡ Work — yang perlu kau approve",
    "tpl": [
      "Senaraikan semua escalation hari ni ⚠️",
      "@Follow-up: apa status escalation ni?",
      "Yang dah approve, tutup & archive ✅"
    ]
  },
  "#random": {
    "label": "random",
    "desc": "sembang santai pasukan",
    "tpl": [
      "Cadang promo hujung minggu 💡",
      "@Customer Assistant: cerita customer paling lawak 😄",
      "Teh tarik sesiapa? ☕"
    ]
  }
};

export const TEAM_REPLIES: Record<string, string[]> = {
  "Customer Assistant": [
    "On it! Saya dah semak — 2 pelanggan tanya waktu operasi, dah balas. Menu terkini hantar ke 3 chat. ✅",
    "Dah settle. 1 pelanggan minta diskaun — aku dah escalate ke ⚡ Work untuk approval kau. ⚠️",
    "Siap! Semua enquiry pagi ni dah dijawab. Tiada yang tertinggal. 👍"
  ],
  "Booking Agent": [
    "Dah semak — 4 booking baru hari ni, semua confirmed. Satu minta tarikh alternatif, dah tawarkan Jumaat. ✅",
    "Booking malam ni: 2 meja 4 orang, 1 meja 2 orang. Semua confirmed, reminder dihantar. 📅",
    "Ada 1 no-show risk — reminder automatik dah hantar. Kalau tak jawab, aku escalate. ⚠️"
  ],
  "Follow-up": [
    "Promo minggu ni dah jadual — 23 pelanggan terima mesej esok 10 pagi. 🎁",
    "Reminder loyaliti dah hantar ke 15 regular. 5 dah reply, 3 booking baru! 🔁",
    "Maklum balas minggu lepas: 8 positif, 2 cadangan. Dah ringkas dalam weekly report. 📊"
  ],
  "Ops Assistant": [
    "Weekly report siap! Jualan naik 12% minggu ni, top item: wagyu set & udon. 📈",
    "Stok wagyu tinggal 3 hari — aku cadang auto-order esok. Nak aku proceed? 📦",
    "Dah track semua — 87 transaksi hari ini, peak hour 7-9pm. Operasi normal. ✅"
  ]
};

export const TEAM_GENERAL: string[] = [
  "Aku dengar! Semua agent sihat dan bekerja. Nak semak apa-apa, terus tag agent yang berkaitan. 😊",
  "Noted! Semua sistem berjalan normal. Contoh: tag @Customer Assistant untuk enquiry, @Ops Assistant untuk report. 👍",
  "Ok! Kalau nak status bahagian tertentu, tag agent dia — aku tolong sampaikan jugak. ✅"
];
