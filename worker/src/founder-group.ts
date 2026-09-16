/** Returns only a configured group invite, not a public frontend constant. */
export function founderGroupUrl(configuredUrl?: string): { url: string } | null {
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com' || url.port ||
        url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9]{20,32}$/.test(url.pathname)) return null;
    return { url: url.href };
  } catch { return null; }
}
