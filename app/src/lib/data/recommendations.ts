/* Ported from the old engine (KV_REC_MAP).
   Data only — hand-edit directly; there's no generator anymore. */

import type { AgentRecommendation } from '../types';

export const REC_MAP: Record<string, AgentRecommendation> = {
  "Inventory & ordering": {
    "e": "📦",
    "n": "Inventory Agent",
    "d": "Watches your stock levels in Sheets or POS and auto-orders before you run out.",
    "tag": "est. 4 hrs/month"
  },
  "Weekly reports": {
    "e": "📊",
    "n": "Reporting Agent",
    "d": "Builds your Monday business report automatically — sales, bookings, issues.",
    "tag": "est. 2 hrs/month"
  },
  "Returns": {
    "e": "🔄",
    "n": "Returns Agent",
    "d": "Guides customers through returns and refunds 24/7, escalating only unusual cases.",
    "tag": "est. 3 hrs/month"
  },
  "Scheduling": {
    "e": "📅",
    "n": "Scheduling Agent",
    "d": "Proposes follow-up times and books meetings without the back-and-forth.",
    "tag": "est. 3 hrs/month"
  },
  "Invoicing": {
    "e": "🧾",
    "n": "Invoicing Agent",
    "d": "Drafts invoices after each job and chases late payments politely.",
    "tag": "est. 4 hrs/month"
  },
  "Billing": {
    "e": "💳",
    "n": "Billing Agent",
    "d": "Sends payment reminders and receipts automatically after each visit.",
    "tag": "est. 3 hrs/month"
  },
  "Product retail": {
    "e": "🛍️",
    "n": "Retail Assistant",
    "d": "Recommends products, checks stock and closes sales on WhatsApp and Instagram.",
    "tag": "est. 5 hrs/month"
  },
  "Loyalty & rebooking": {
    "e": "🎁",
    "n": "Loyalty Agent",
    "d": "Turns one-time customers into regulars with rebooking offers and perks.",
    "tag": "est. 4 hrs/month"
  },
  "Renewals": {
    "e": "🔁",
    "n": "Renewals Agent",
    "d": "Tracks memberships ending soon and sends renewal offers automatically.",
    "tag": "est. 3 hrs/month"
  },
  "Trial sign-ups": {
    "e": "🎟️",
    "n": "Trial Agent",
    "d": "Books trial sessions and follows up to convert them into members.",
    "tag": "est. 4 hrs/month"
  },
  "Attendance": {
    "e": "📋",
    "n": "Attendance Agent",
    "d": "Tracks attendance and flags patterns — fewer missed classes, fewer gaps.",
    "tag": "est. 2 hrs/month"
  },
  "Progress reports": {
    "e": "📈",
    "n": "Progress Agent",
    "d": "Sends parents monthly progress updates without you writing them.",
    "tag": "est. 3 hrs/month"
  },
  "Reports": {
    "e": "📊",
    "n": "Reporting Agent",
    "d": "Turns your daily data into a weekly summary you can read in 2 minutes.",
    "tag": "est. 2 hrs/month"
  }
};
