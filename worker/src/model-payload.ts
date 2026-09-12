/** Bound transient model context, not the stored transcript or artifact files. */
const TOOL_CHARS = 32_000;
const IMAGE_NOTICE = '[Image from an earlier turn omitted. Re-open its artifact if needed.]';

function boundedToolText(text: string): string {
  if (text.length <= TOOL_CHARS) return text;
  return text.slice(0, TOOL_CHARS / 2) + '\n[Tool output truncated for model context. Read the original file for omitted details.]\n' + text.slice(-TOOL_CHARS / 2);
}

export function prepareModelPayload(body: Record<string, unknown>): { body: Record<string, unknown>; hasImage: boolean } {
  if (!Array.isArray(body.messages)) return { body, hasImage: false };
  let latestUser = -1;
  body.messages.forEach((message, i) => { if (message?.role === 'user') latestUser = i; });
  let hasImage = false;
  const messages = body.messages.map((message, i) => {
    if (!message || typeof message !== 'object') return message;
    let content = message.content;
    if (Array.isArray(content)) {
      content = content.map(part => {
        if (part?.type === 'image_url') {
          // Keep current-turn vision input intact; never fetch a URL here.
          if (latestUser >= 0 && i < latestUser && ['user', 'tool', 'assistant'].includes(message.role)) {
            return { type: 'text', text: IMAGE_NOTICE };
          }
          hasImage = true;
        }
        if (message.role === 'tool' && part?.type === 'text' && typeof part.text === 'string') {
          return { ...part, text: boundedToolText(part.text) };
        }
        return part;
      });
    } else if (message.role === 'tool' && typeof content === 'string') {
      content = boundedToolText(content);
    }
    return { ...message, content };
  });
  return { body: { ...body, messages }, hasImage };
}

/** Read actual bytes with a hard cap even when Content-Length is missing. */
export async function readModelBody(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
