/** Read top-level fences only; quoted or nested examples are never requests. */
export function replyRequestBlocks(text: string, tag: 'jentera-browser' | 'jentera-connect'): { raw: string; content: string }[] {
  const blocks: { raw: string; content: string }[] = [];
  let open: RegExpMatchArray | undefined;
  for (const fence of text.matchAll(/^(`{3,}|~{3,})([^\r\n]*)(?=\r?$)/gm)) {
    if (!open) { open = fence; continue; }
    if (fence[1][0] !== open[1][0] || fence[1].length < open[1].length || fence[2].trim()) continue;
    if (open[1] === '```' && open[2].trim() === tag) {
      blocks.push({ raw: text.slice(open.index!, fence.index! + fence[0].length),
        content: text.slice(open.index! + open[0].length, fence.index) });
    }
    open = undefined;
  }
  return blocks;
}

export function hideStreamingReplyRequest(text: string, tag: 'jentera-browser' | 'jentera-connect'): string {
  return text.replace(new RegExp('^```' + tag + '\\b[\\s\\S]*?(?:^```[ \\t]*\\r?$|(?![\\s\\S]))', 'gm'), '').trimEnd();
}
