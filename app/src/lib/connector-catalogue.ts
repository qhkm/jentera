import { CONNECTORS } from '@/lib/data/connectors';
import { isLive } from '@/lib/live-connectors';
import type { Connector, Lang } from '@/lib/types';

export const CONNECTOR_CATEGORIES = {
  google: { en: 'Google Workspace', bm: 'Google Workspace' },
  messaging: { en: 'Messaging', bm: 'Pemesejan' },
  commerce: { en: 'Commerce', bm: 'Perdagangan' },
  payments: { en: 'Payments', bm: 'Pembayaran' },
  operations: { en: 'Operations', bm: 'Operasi' },
  accounting: { en: 'Accounting', bm: 'Perakaunan' },
  other: { en: 'Other apps', bm: 'Aplikasi lain' },
} as const;

export type ConnectorCategory = keyof typeof CONNECTOR_CATEGORIES;
export interface CatalogueEntry {
  id: string;
  name: string;
  icon: string;
  category: ConnectorCategory;
  availability: 'available' | 'pilot' | 'planned';
  description: Record<Lang, string>;
}

function category(id: string, item: Connector): ConnectorCategory {
  if (item.category) return item.category;
  if (['telegram', 'whatsapp', 'instagram'].includes(id)) return 'messaging';
  if (item['e-invoice']) return 'accounting';
  if (item.fpga || id === 'duitnow') return 'payments';
  if (item.marketplace) return 'commerce';
  if (item.delivery || item.pos || item.courier) return 'operations';
  return 'other';
}

/** A catalogue entry cannot turn a planned OAuth app into a token form. */
export function permitsTokenConnector(id: string): boolean {
  return id !== 'google' && id !== 'telegram' && CONNECTORS[id]?.availability !== 'planned';
}

export function getConnectorCatalogue(tokens: { connector: string; label: string }[] = []): CatalogueEntry[] {
  const entries: CatalogueEntry[] = Object.entries(CONNECTORS).map(([id, item]) => {
    const supported = item.availability !== 'planned'
      && (isLive(item.n) || tokens.some(token => token.connector === id && permitsTokenConnector(id)));
    return {
      id, name: item.n, icon: item.e, category: category(id, item),
      availability: supported ? item.availability === 'pilot' ? 'pilot' : 'available' : 'planned',
      description: item.description ?? (id === 'telegram' ? {
        en: 'Pair your private owner chat. Ask Jentera for help and review its work from your phone.',
        bm: 'Pasangkan chat peribadi pemilik. Minta bantuan Jentera dan semak kerjanya dari telefon anda.',
      } : supported ? {
        en: 'Connect using a limited token you control. Access can be revoked from the provider.',
        bm: 'Sambung menggunakan token terhad yang anda kawal. Akses boleh dibatalkan melalui penyedia.',
      } : {
        en: `A planned ${CONNECTOR_CATEGORIES[category(id, item)].en.toLowerCase()} connection. Not available to connect yet.`,
        bm: `Sambungan ${CONNECTOR_CATEGORIES[category(id, item)].bm.toLowerCase()} yang dirancang. Belum tersedia untuk disambungkan.`,
      }),
    };
  });
  for (const token of tokens) {
    if (CONNECTORS[token.connector] || !permitsTokenConnector(token.connector)) continue;
    entries.push({
      id: token.connector, name: token.label, icon: '🔗', category: 'other', availability: 'available',
      description: {
        en: 'Connect using a limited token you control. Access can be revoked from the provider.',
        bm: 'Sambung menggunakan token terhad yang anda kawal. Akses boleh dibatalkan melalui penyedia.',
      },
    });
  }
  return entries.sort((a, b) => Number(a.availability === 'planned') - Number(b.availability === 'planned') || a.name.localeCompare(b.name));
}

export function matchesConnector(entry: CatalogueEntry, query: string, lang: Lang = 'en'): boolean {
  return `${entry.name} ${CONNECTOR_CATEGORIES[entry.category][lang]} ${entry.description[lang]}`
    .toLowerCase().includes(query.trim().toLowerCase());
}
