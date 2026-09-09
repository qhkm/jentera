import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { metaEntries, pageSeo, structuredData } from '@/lib/seo';

/** Static HTML serves bots. This keeps the same metadata correct after SPA navigation. */
export function PageMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const seo = pageSeo(pathname);
    document.title = seo.title;
    for (const { attribute, key, content } of metaEntries(pathname)) {
      const matches = document.head.querySelectorAll<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      const tag = matches[0] ?? document.createElement('meta');
      tag.setAttribute(attribute, key);
      tag.content = content;
      if (!tag.isConnected) document.head.append(tag);
      matches.forEach((duplicate, index) => { if (index > 0) duplicate.remove(); });
    }
    document.head.querySelectorAll('link[rel="canonical"]').forEach((link) => link.remove());
    if (seo.canonical) {
      const link = document.createElement('link'); link.rel = 'canonical'; link.href = seo.canonical;
      document.head.append(link);
    }
    document.getElementById('jentera-structured-data')?.remove();
    const data = structuredData(pathname);
    if (data) {
      const script = document.createElement('script'); script.id = 'jentera-structured-data'; script.type = 'application/ld+json';
      script.textContent = JSON.stringify(data); document.head.append(script);
    }
    if (seo.indexable || pathname === '/signin') document.documentElement.lang = 'en';
  }, [pathname]);
  return null;
}
