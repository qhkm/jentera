import { describe, expect, it } from 'vitest';
import { CONNECTORS } from '@/lib/data/connectors';
import { getConnectorCatalogue, matchesConnector, permitsTokenConnector } from '@/lib/connector-catalogue';

describe('shared connector catalogue', () => {
  it('preserves the existing Calendar identity and keeps every future Google app planned', () => {
    const google = getConnectorCatalogue().filter(entry => entry.category === 'google');
    expect(google).toHaveLength(8);
    expect(google.find(entry => entry.id === 'google')).toMatchObject({ name: 'Google Calendar', availability: 'pilot' });
    const planned = google.filter(entry => entry.id !== 'google');
    for (const entry of planned) {
      expect(entry.availability).toBe('planned');
      expect(permitsTokenConnector(entry.id)).toBe(false);
      expect(CONNECTORS[entry.id].scope).toEqual([]);
      expect(entry.description.en).toBeTruthy();
      expect(entry.description.bm).toBeTruthy();
    }
    expect(getConnectorCatalogue(planned.map(entry => ({ connector: entry.id, label: entry.name })))
      .filter(entry => entry.category === 'google' && entry.availability !== 'planned')).toHaveLength(1);
  });

  it('uses actual server-supported token entries without bypassing the OAuth-only flows', () => {
    const catalogue = getConnectorCatalogue([{ connector: 'github', label: 'GitHub' }]);
    expect(catalogue.find(entry => entry.id === 'github')?.availability).toBe('available');
    expect(permitsTokenConnector('google')).toBe(false);
    expect(permitsTokenConnector('telegram')).toBe(false);
    expect(new Set(catalogue.map(entry => entry.id)).size).toBe(catalogue.length);
  });

  it('searches names, categories and descriptions in either language', () => {
    const sheets = getConnectorCatalogue().find(entry => entry.id === 'google-sheets')!;
    expect(matchesConnector(sheets, '  GOOGLE workspace ')).toBe(true);
    expect(matchesConnector(sheets, 'hamparan', 'bm')).toBe(true);
    expect(matchesConnector(sheets, 'Telegram')).toBe(false);
  });
});
