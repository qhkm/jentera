import { isRunId } from '@/lib/task';

export type BrowserHandoffReason = 'sign_in' | 'mfa' | 'user_action';

function requestBlocks(text: string): { raw: string; content: string }[] {
  const blocks: { raw: string; content: string }[] = [];
  let open: RegExpMatchArray | undefined;
  // Track surrounding fences so a marker inside a code example is not a card.
  for (const fence of text.matchAll(/^(`{3,}|~{3,})([^\r\n]*)(?=\r?$)/gm)) {
    if (!open) { open = fence; continue; }
    if (fence[1][0] !== open[1][0] || fence[1].length < open[1].length || fence[2].trim()) continue;
    if (open[1] === '```' && open[2].trim() === 'jentera-browser') {
      blocks.push({ raw: text.slice(open.index!, fence.index! + fence[0].length),
        content: text.slice(open.index! + open[0].length, fence.index) });
    }
    open = undefined;
  }
  return blocks;
}

/** A display-only request, never an approval, navigation command, or credential.
 * Only finished agent replies with a durable run identity may offer the viewer. */
export function browserHandoff(text: string, runId?: string): { text: string; reason?: BrowserHandoffReason } {
  const blocks = requestBlocks(text);
  if (blocks.length !== 1 || !isRunId(runId) || blocks[0].content.length > 128) return { text };
  try {
    const value: unknown = JSON.parse(blocks[0].content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { text };
    const data = value as Record<string, unknown>;
    if (Object.keys(data).length !== 1 || typeof data.reason !== 'string' || !['sign_in', 'mfa', 'user_action'].includes(data.reason)) return { text };
    return { text: text.replace(blocks[0].raw, '').trim(), reason: data.reason as BrowserHandoffReason };
  } catch {
    return { text };
  }
}

/** Hide incomplete control blocks while text streams; no viewer until done. */
export function hideStreamingBrowserHandoff(text: string): string {
  return text.replace(/^```jentera-browser\b[\s\S]*?(?:^```[ \t]*\r?$|(?![\s\S]))/gm, '').trimEnd();
}
