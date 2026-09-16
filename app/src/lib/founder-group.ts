export function parseFounderGroup(value: unknown): { url: string } | null {
  if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') return null;
  try {
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com' || url.port ||
        url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9]{20,32}$/.test(url.pathname)) return null;
    return { url: url.href };
  } catch { return null; }
}
