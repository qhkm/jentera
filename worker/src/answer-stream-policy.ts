import { needsCurrentSources, needsHighStakesSources } from './source-review';

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

/** Whether the owner waits for the answer's checks before seeing it.
 *
 * The checks run either way; this decides only the order. Three of the four
 * answer warnings require a question asking for current or high-stakes
 * information, and the fourth follows from an action the agent claims to have
 * taken — every one of those classes is already held from streaming. So an
 * answer this policy would have revealed token by token is delivered as soon
 * as it exists, and one it held still waits, which is what keeps a caution
 * ahead of the answer it applies to rather than behind it.
 *
 * `needsHighStakesSources` is tested as well as the hold reason: the two
 * vocabularies are maintained separately, and a term added to only one of
 * them must not turn into an answer delivered ahead of its warning.
 */
export function holdAnswerForChecks(question: string): boolean {
  return Boolean(streamHoldReason(question)) ||
    needsCurrentSources(question) || needsHighStakesSources(question);
}

/** Preview is disposable; the durable final result is delivered only after
 * review. Once held, stay held across subsequent tool and delta events.
 */
export function createAnswerStreamGate(question: string, resumed = false) {
  let reason = resumed ? 'resumed_run' as StreamHoldReason : streamHoldReason(question);
  let emitted = false;
  return {
    get reason() { return reason; },
    /** Whether any answer text has reached a screen through this gate. Only
        ever true of the slice that owns the gate: a later slice builds a new
        one and cannot see what an earlier one let through. */
    get emitted() { return emitted; },
    toolStarted() { reason ??= 'tool_used'; },
    async forward(delta: string, emit: (text: string) => Promise<void>) {
      if (reason) return;
      emitted = true;
      await emit(delta);
    },
  };
}

/** While held, don't let a reasoning or @step lane become an answer bypass. */
export function heldProgressLabel(label: string, reason?: StreamHoldReason | null): string {
  const labels = new Set(['Checking the sources', 'Checking task status', 'Reading information',
    'Searching for information', 'Comparing sources', 'Reviewing the result', 'Preparing the answer',
    'Menyemak sumber', 'Menyemak status tugasan', 'Membaca maklumat', 'Mencari maklumat',
    'Membandingkan sumber', 'Menyemak hasil', 'Menyediakan jawapan']);
  if (labels.has(label)) return label;
  const bm = /^(Menyemak|Membaca|Mencari|Membandingkan|Menyediakan)/i.test(label);
  if (reason === 'current_information') return bm ? 'Menyemak sumber semasa' : 'Checking current sources';
  if (reason === 'high_stakes') return bm ? 'Menyemak butiran penting' : 'Checking important details';
  if (reason === 'action') return bm ? 'Menyemak tindakan diminta' : 'Checking the requested action';
  if (reason === 'ambiguous_followup') return bm ? 'Menyemak perkara untuk diteruskan' : 'Checking what to continue';
  if (reason === 'resumed_run') return bm ? 'Menyemak kemajuan tugasan' : 'Checking task progress';
  if (reason === 'tool_used') return bm ? 'Meneruskan tugasan' : 'Continuing the task';
  return bm ? 'Menyemak status tugasan' : 'Checking the task';
}
