import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useRepository } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';
import { useI18n } from '@/i18n/I18nProvider';
import { CONNECTOR_CATEGORIES, getConnectorCatalogue, matchesConnector, type ConnectorCategory } from '@/lib/connector-catalogue';
import { ConnectorCard } from '@/components/ConnectorCard';
import TelegramConnect from '@/routes/views/TelegramConnect';
import TokenConnect from '@/routes/views/TokenConnect';
import GoogleCalendarConnect from '@/routes/views/GoogleCalendarConnect';

type Filter = 'all' | 'available' | 'connected' | 'planned';

export function ConnectorOptions({ connections, setupMode = 'inline' }: { connections: ConnectionsState; setupMode?: 'inline' | 'existing' }) {
  const repo = useRepository();
  const { lang, t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [tokens, setTokens] = useState<{ connector: string; label: string }[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalogError(false);
    setTokens([]);
    repo.tokenConnectors().then(rows => { if (active) setTokens(rows); }).catch(() => { if (active) setCatalogError(true); });
    return () => { active = false; };
  }, [repo, attempt]);
  const options = getConnectorCatalogue(tokens);
  const getRow = (id: string) => connections.rows?.find(row => row.connector === id && row.status === 'connected' && (id !== 'telegram' || row.paired))
    ?? connections.rows?.find(row => row.connector === id && row.status === 'connected')
    ?? connections.rows?.find(row => row.connector === id);
  const isConnected = (id: string) => connections.mode === 'real' && getRow(id)?.status === 'connected'
    && (id !== 'telegram' || !!getRow(id)?.paired);
  const visible = options.filter(item => matchesConnector(item, query, lang)
    && (category === 'all' || category === item.category)
    && (filter === 'all' || (filter === 'planned' ? item.availability === 'planned'
      : filter === 'available' ? item.availability !== 'planned' : item.availability !== 'planned' && isConnected(item.id))));
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('connectors.all') },
    { id: 'available', label: t('connectors.available') },
    { id: 'connected', label: t('connectors.connected') },
    { id: 'planned', label: t('connectors.planned') },
  ];
  return <div className="connector-options">
    <div className="connector-toolbar">
      <label className="connector-search">{t('connectors.find')}<input className="input" type="search" value={query}
        onChange={event => { setQuery(event.target.value); setSelected(null); }} placeholder={t('connectors.search')} /></label>
      <label className="connector-search">{t('connectors.category')}<select className="input" value={category}
        onChange={event => { setCategory(event.target.value as typeof category); setSelected(null); }}>
        <option value="all">{t('connectors.categories')}</option>
        {Object.entries(CONNECTOR_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label[lang]}</option>)}
      </select></label>
    </div>
    <div className="connector-filters" role="group" aria-label={t('connectors.filter')}>
      {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id}
        onClick={() => { setFilter(item.id); setSelected(null); }}>{item.label}</button>)}
    </div>
    <p className="connector-directory-note">{t('connectors.note')}</p>
    {catalogError && <p role="alert">{t('connectors.catalogError')} <button className="routine-link" type="button" onClick={() => setAttempt(n => n + 1)}>{t('connectors.retryCatalog')}</button></p>}
    {connections.mode === 'error' && <p role="alert">{t('connectors.statusError')} <button className="routine-link" type="button" onClick={connections.retry}>{t('connectors.retryStatus')}</button></p>}
    <ul className="connector-grid connector-list">{visible.map(item => {
      const supported = item.availability !== 'planned';
      const row = getRow(item.id);
      const status = !supported ? t('connectors.unavailable') : connections.mode === 'pending' ? t('connectors.checking')
        : connections.mode === 'error' ? t('connectors.statusUnavailable') : connections.mode === 'demo' ? t('connectors.signinDetail')
        : isConnected(item.id) ? t('connectors.connected') : row?.status === 'connected' ? t('connectors.pair')
          : row?.status === 'error' ? t('connectors.attention') : t('connectors.disconnected');
      const open = supported && selected === item.id;
      const action = open ? t('connectors.close') : row ? t('connectors.manage') : t('connectors.connect');
      return <li key={item.id} className={open ? 'connector-option-open' : undefined}>
        <ConnectorCard entry={item} lang={lang} status={status} connected={supported && isConnected(item.id)}>
          {supported && (connections.mode === 'demo' ? <Link className="btn btn-outline" to="/signin">{t('connectors.signin')}</Link>
            : setupMode === 'existing' && connections.mode === 'real' ? <a className="btn btn-outline" href={`#connection-${['telegram', 'google'].includes(item.id) ? item.id : 'tokens'}`} aria-label={`${action} ${item.name}`}>{action}</a>
              : <button type="button" className="btn btn-outline" disabled={connections.mode !== 'real'} aria-expanded={open} aria-controls={open ? `connector-${item.id}` : undefined}
                aria-label={`${action} ${item.name}`} onClick={() => setSelected(open ? null : item.id)}>{action}</button>)}
        </ConnectorCard>
        {open && setupMode === 'inline' && connections.mode === 'real' && <div className="connector-inline-setup" id={`connector-${item.id}`}>
          {item.id === 'telegram' ? <TelegramConnect rows={connections.rows} setRows={connections.setRows} />
            : item.id === 'google' ? <GoogleCalendarConnect rows={connections.rows} setRows={connections.setRows} />
              : <TokenConnect connector={item.id} rows={connections.rows} setRows={connections.setRows} />}
        </div>}
      </li>;
    })}</ul>
    {!visible.length && <p role="status" className="connector-empty">{filter === 'connected' && connections.mode !== 'real'
      ? t('connectors.unknown') : t('connectors.empty')}</p>}
  </div>;
}
