import { needsCurrentSources } from './source-review';

export type StreamHoldReason = 'current_information' | 'high_stakes' | 'action' | 'ambiguous_followup' | 'resumed_run' | 'tool_used';

/** Conservative intent heuristics, not a universal risk classifier. Never try
 * to recognise a dangerous sentence token-by-token after its prefix is public.
 */
export function streamHoldReason(question: string): StreamHoldReason | null {
  if (needsCurrentSources(question)) return 'current_information';
  if (/\b(tax|taxes|financial|investment|invest|loan|interest rate|invoice|billing|cost|costs|budget|medical|medicine|dosage|diagnos\w*|legal|law|laws|contract|cukai|kewangan|pelaburan|pinjaman|faedah|invois|kos|bajet|ubat|dos|diagnosis|undang-undang|kontrak)\b/i.test(question)) return 'high_stakes';
  if (/\b(send|sent|publish|deploy|install|delete|remove|transfer|purchase|buy|pay|schedule|remind|reminder|connect|login|log in|update|cancel|done|finished|completed|hantar|dihantar|terbitkan|pasang|padam|buang|pindah|beli|bayar|jadual\w*|ingatkan|peringatan|sambung|kemas kini|batalkan|siap|selesai)\b/i.test(question)) return 'action';
  if (!question.trim() || /^(yes|yep|ok(?:ay)?|sure|proceed|continue|retry|do it|go ahead|ya|boleh|teruskan|cuba lagi)[.!?\s]*$/i.test(question.trim())) return 'ambiguous_followup';
  return null;
}

/** Preview is disposable; the durable final result is delivered only after
 * review. Once held, stay held across subsequent tool and delta events.
 */
export function createAnswerStreamGate(question: string, resumed = false) {
  let reason = resumed ? 'resumed_run' as StreamHoldReason : streamHoldReason(question);
  return {
    get reason() { return reason; },
    toolStarted() { reason ??= 'tool_used'; },
    async forward(delta: string, emit: (text: string) => Promise<void>) {
      if (!reason) await emit(delta);
    },
  };
}

/** While held, don't let a reasoning or @step lane become an answer bypass. */
export function heldProgressLabel(label: string): string {
  const labels = new Set(['Checking the sources', 'Checking task status', 'Reading information',
    'Searching for information', 'Comparing sources', 'Reviewing the result', 'Preparing the answer',
    'Menyemak sumber', 'Menyemak status tugasan', 'Membaca maklumat', 'Mencari maklumat',
    'Membandingkan sumber', 'Menyemak hasil', 'Menyediakan jawapan']);
  return labels.has(label) ? label : /^(Menyemak|Membaca|Mencari|Membandingkan|Menyediakan)/i.test(label)
    ? 'Menyemak status tugasan' : 'Checking the task';
}
