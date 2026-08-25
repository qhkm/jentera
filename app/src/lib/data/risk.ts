/* Ported from the old engine (KV_TOOL_RISK).
   Data only — hand-edit directly; there's no generator anymore. */

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
