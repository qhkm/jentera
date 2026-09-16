import { isRunId } from '@/lib/task';
import { hideStreamingReplyRequest, replyRequestBlocks } from '@/lib/reply-request';

/** Display-only setup shortcut. The model cannot choose URLs, scopes or credentials. */
export function connectionHandoff(text: string, runId?: string): { text: string; connector?: 'google_calendar' } {
  const blocks = replyRequestBlocks(text, 'jentera-connect');
  if (blocks.length !== 1 || !isRunId(runId) || blocks[0].content.length > 128) return { text };
  try {
    const value: unknown = JSON.parse(blocks[0].content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { text };
    const data = value as Record<string, unknown>;
    if (Object.keys(data).length !== 1 || data.connector !== 'google_calendar') return { text };
    return { text: text.replace(blocks[0].raw, '').trim(), connector: 'google_calendar' };
  } catch {
    return { text };
  }
}

export function hideStreamingConnectionHandoff(text: string): string {
  return hideStreamingReplyRequest(text, 'jentera-connect');
}
