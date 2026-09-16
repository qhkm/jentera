import { isRunId } from '@/lib/task';
import { hideStreamingReplyRequest, replyRequestBlocks } from '@/lib/reply-request';

export type BrowserHandoffReason = 'sign_in' | 'mfa' | 'user_action';

/** A display-only request, never an approval, navigation command, or credential.
 * Only finished agent replies with a durable run identity may offer the viewer. */
export function browserHandoff(text: string, runId?: string): { text: string; reason?: BrowserHandoffReason } {
  const blocks = replyRequestBlocks(text, 'jentera-browser');
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
  return hideStreamingReplyRequest(text, 'jentera-browser');
}
