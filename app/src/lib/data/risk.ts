/* Ported verbatim from biz-engine.js (KV_TOOL_RISK).
   Data only — regenerate rather than hand-edit if the source moves. */

import type { Risk } from '../types';

export const TOOL_RISK: Record<string, Risk> = {
  "send": "high",
  "pay": "high",
  "cancel": "high",
  "refund": "high",
  "update": "medium",
  "book": "medium",
  "read": "low",
  "list": "low",
  "export": "low"
};
