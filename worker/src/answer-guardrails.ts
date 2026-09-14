import type { TaskAssessment } from './task-outcome';
import { needsCurrentSources, needsHighStakesSources, type SourceReview } from './source-review';

export type AnswerWarning = 'missing_current_sources' | 'unverified_completion' | 'source_review_incomplete' | 'source_support_missing';

/** A deterministic minimum-evidence check, NOT a factual-accuracy verdict.
 * A citation's presence does not establish that its contents support a claim.
 * Never fetch model-supplied URLs here (SSRF), or ask another model to rubber-stamp it.
 */
export function guardAnswer(result: unknown, question: string, assessment: TaskAssessment | null, review?: SourceReview) {
  const text = typeof result === 'string' ? result
    : result && typeof result === 'object' && 'text' in result && typeof result.text === 'string' ? result.text : '';
  const warnings: AnswerWarning[] = [];
  if (!text.trim()) return { result, warnings };
  const current = needsCurrentSources(question) || needsHighStakesSources(question);
  // Require a usable http(s) citation; arbitrary link labels are not evidence.
  const urls = text.match(/https?:\/\/[^\s<>\)\]]+/gi) ?? [];
  const hasSource = urls.some(value => {
    try { const url = new URL(value); return Boolean(url.hostname.includes('.') && !url.username && !url.password); }
    catch { return false; }
  });
  if (current && !hasSource) warnings.push('missing_current_sources');
  if (review?.status === 'incomplete') warnings.push('source_review_incomplete');
  if (review?.status === 'unsupported') warnings.push('source_support_missing');
  if (assessment?.uncertaintyReason === 'missing_external_verification' ||
      assessment?.uncertaintyReason === 'missing_completion_evidence') warnings.push('unverified_completion');
  if (!warnings.length) return { result, warnings };
  const bm = /\b(tolong|saya|boleh|terkini|terbaru|hari ini|semak|harga|tugasan)\b/i.test(question);
  const notices = warnings.map(warning => warning === 'source_review_incomplete'
    ? bm ? 'Semakan sumber tidak lengkap. Dakwaan semasa masih perlu disahkan.'
      : 'Source review is incomplete. Factual claims still need checking.'
    : warning === 'source_support_missing'
    ? bm ? 'Semakan tidak menemui sokongan yang mencukupi untuk semua dakwaan dalam petikan sumber. Jangan bergantung pada jawapan ini tanpa semakan lanjut.'
      : 'The review could not establish source support for all claims. Do not rely on this answer without further checking.'
    : warning === 'missing_current_sources'
    ? bm ? 'Jawapan ini tidak menyertakan pautan sumber untuk maklumat semasa. Semak dakwaan tersebut sebelum bertindak.'
      : 'This answer does not include source links for factual information. Check those claims before acting.'
    : bm ? 'Jentera tidak dapat mengesahkan tindakan yang didakwa selesai. Semak status sebelum mencuba lagi.'
      : 'Jentera could not verify the claimed completion. Check the action’s status before trying again.');
  const prefix = `> ${bm ? 'Nota pengesahan' : 'Verification note'}: ${notices.join(' ')}\n\n`;
  const guarded = text.startsWith(prefix) ? text : prefix + text;
  return { result: typeof result === 'string' ? guarded : { ...result as Record<string, unknown>, text: guarded }, warnings };
}
