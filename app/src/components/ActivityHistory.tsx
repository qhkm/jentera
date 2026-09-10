import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle,
  Clock,
  MagnifyingGlass,
  Tray,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui';
import type { Activity } from '@/lib/repo';

type Work = Activity['work'][number];
type Filter = 'all' | 'review' | 'progress' | 'completed' | 'issues';
const FILTERS: Filter[] = ['all', 'review', 'progress', 'completed', 'issues'];

function matches(work: Work, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'review') return ['needs_approval', 'needs_input', 'needs_review'].includes(work.status);
  if (filter === 'completed') return work.status === 'completed';
  if (filter === 'issues') return work.status === 'failed' || work.status === 'blocked';
  return !['completed', 'needs_approval', 'needs_input', 'needs_review', 'failed', 'blocked', 'cancelled'].includes(work.status);
}

export function ActivityHistory({
  work,
  children,
  onOpenAsk,
}: {
  work: Work[];
  children: (record: Work) => ReactNode;
  onOpenAsk?: () => void;
}) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((key) => [key, work.filter((record) => matches(record, key)).length]),
      ) as Record<Filter, number>,
    [work],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return work
      .filter(
        (record) =>
          matches(record, filter) &&
          [record.objective, record.outcome, record.channel, record.subject].some((value) =>
            value?.toLocaleLowerCase(locale).includes(needle),
          ),
      )
      .sort((a, b) => (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0));
  }, [work, filter, query, locale]);

  // Group by the owner's local calendar day, not UTC or a rolling 24-hour window.
  const groups = new Map<string, Work[]>();
  for (const record of shown) {
    const date = new Date(record.occurredAt);
    const day = Number.isNaN(date.getTime()) ? '' : date.toDateString();
    groups.set(day, [...(groups.get(day) ?? []), record]);
  }
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  function dateLabel(day: string) {
    if (!day) return t('activity.undated');
    if (day === today.toDateString()) return t('activity.today');
    if (day === yesterday.toDateString()) return t('activity.yesterday');
    return new Date(day).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  if (!work.length)
    return (
      <section className="workspace-empty">
        <span className="workspace-empty-icon">
          <Tray size={34} weight="duotone" aria-hidden="true" />
        </span>
        <h2>{t('activity.empty.title')}</h2>
        <p>{t('activity.empty.detail')}</p>
        {onOpenAsk && (
          <Button onClick={onOpenAsk}>
            {t('view.chat')}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        )}
      </section>
    );

  return (
    <section className="activity-history" aria-label={t('activity.history')}>
      <header className="workspace-section-heading">
        <div>
          <h2>{t('activity.history')}</h2>
          <p>{t('activity.history.detail')}</p>
        </div>
      </header>
      <div className="activity-overview">
        {(
          [
            { key: 'completed', icon: CheckCircle },
            { key: 'progress', icon: Clock },
            { key: 'issues', icon: WarningCircle },
          ] as const
        ).map(({ key, icon: StatusIcon }) => (
          <button
            type="button"
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter((current) => (current === key ? 'all' : key))}
          >
            <StatusIcon size={21} weight="duotone" aria-hidden="true" />
            <strong>{counts[key]}</strong>
            <span>{t(`activity.${key}`)}</span>
          </button>
        ))}
      </div>
      <div className="activity-tools">
        <div className="workspace-search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('activity.search')}
            aria-label={t('activity.search')}
          />
          {query && (
            <button type="button" aria-label={t('activity.clear')} onClick={() => setQuery('')}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="activity-filters" role="group" aria-label={t('activity.filter')}>
          {FILTERS.map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(`activity.${key}`)}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="activity-result-count" role="status">
        {t('activity.results', { shown: shown.length, total: work.length })}
      </p>
      {shown.length === 0 ? (
        <div className="workspace-empty workspace-empty-compact">
          <MagnifyingGlass size={28} aria-hidden="true" />
          <h3>{t('activity.noresults')}</h3>
          <p>{t('activity.noresults.detail')}</p>
          <Button
            variant="outline"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            {t('activity.reset')}
          </Button>
        </div>
      ) : (
        [...groups].map(([day, records]) => (
          <section className="activity-day" key={day} aria-label={dateLabel(day)}>
            <h3>
              {dateLabel(day)}
              <span>{records.length}</span>
            </h3>
            <div className="activity-records">
              {records.map((record) => (
                <div key={record.id}>{children(record)}</div>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
