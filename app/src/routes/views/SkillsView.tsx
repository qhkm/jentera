import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, Hammer, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { Button, Tag } from '@/components/ui';
import { useRepository, type RuntimeSkill } from '@/lib/repo';
import { useT } from '@/i18n/I18nProvider';
import '@/styles/skills.css';

type SkillsState =
  | { status: 'loading'; skills: RuntimeSkill[] }
  | { status: 'ready'; skills: RuntimeSkill[] }
  | { status: 'error'; skills: RuntimeSkill[]; message: string };

export default function SkillsView() {
  const repo = useRepository();
  const t = useT();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SkillsState>({ status: 'loading', skills: [] });

  const load = useCallback(async () => {
    setState(current => ({ status: 'loading', skills: current.skills }));
    try {
      setState({ status: 'ready', skills: await repo.runtimeSkills() });
    } catch (error) {
      setState(current => ({
        status: 'error',
        skills: current.skills,
        message: error instanceof Error ? error.message : t('skills.error'),
      }));
    }
  }, [repo, t]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = state.skills.filter(skill => !needle ||
      skill.name.toLocaleLowerCase().includes(needle) ||
      skill.description.toLocaleLowerCase().includes(needle) ||
      skill.category?.toLocaleLowerCase().includes(needle));
    const grouped = new Map<string, RuntimeSkill[]>();
    for (const skill of filtered) {
      const category = skill.category?.trim() || t('skills.uncategorized');
      grouped.set(category, [...(grouped.get(category) ?? []), skill]);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, skills]) => ({
        category,
        skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [query, state.skills, t]);

  const firstLoad = state.status === 'loading' && state.skills.length === 0;
  return <section className="skills-view" aria-labelledby="skills-title">
    <header className="skills-header">
      <div>
        <h1 id="skills-title">{t('skills.title')}</h1>
        <p>{t('skills.description')}</p>
      </div>
      {/* The label is its own element so the mobile rule can drop it and
          leave an icon. aria-label carries the name at every width. */}
      <Button type="button" variant="outline" aria-label={t('skills.refresh')}
        onClick={() => void load()} disabled={state.status === 'loading'}>
        <ArrowClockwise size={16} aria-hidden="true" />
        <span>{t('skills.refresh')}</span>
      </Button>
    </header>

    {firstLoad ? <div className="skills-state" role="status">
      <span className="skills-state-icon"><ArrowClockwise size={24} aria-hidden="true" /></span>
      <strong>{t('skills.loading')}</strong>
    </div> : state.status === 'error' && state.skills.length === 0 ? <div className="skills-state" role="alert">
      <span className="skills-state-icon"><WarningCircle size={24} aria-hidden="true" /></span>
      <strong>{t('skills.error')}</strong>
      <p>{state.message}</p>
      <Button type="button" variant="outline" onClick={() => void load()}>{t('skills.retry')}</Button>
    </div> : state.skills.length === 0 ? <div className="skills-state">
      <span className="skills-state-icon"><Hammer size={24} aria-hidden="true" /></span>
      <strong>{t('skills.empty')}</strong>
      <p>{t('skills.empty.detail')}</p>
    </div> : <>
      <label className="skills-search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('skills.search')} aria-label={t('skills.search')} />
      </label>
      {state.status === 'error' && <div className="skills-inline-error" role="status">
        <WarningCircle size={16} aria-hidden="true" />{t('skills.stale')}
      </div>}
      {groups.length === 0 ? <div className="skills-state skills-state-compact">
        <strong>{t('skills.noResults')}</strong>
        <p>{t('skills.noResults.detail', { query: query.trim() })}</p>
      </div> : <div className="skills-groups">
        {groups.map(group => <section key={group.category} className="skills-group" aria-labelledby={`skill-category-${slug(group.category)}`}>
          <header>
            <h2 id={`skill-category-${slug(group.category)}`}>{group.category}</h2>
            <span>{group.skills.length}</span>
          </header>
          <div className="skills-list">
            {group.skills.map(skill => <article key={skill.name} className={skill.disabled ? 'is-disabled' : undefined}>
              <span className="skills-row-icon" aria-hidden="true"><Hammer size={18} weight="duotone" /></span>
              <div>
                <h3>{skill.name}</h3>
                {skill.description && <p>{skill.description}</p>}
              </div>
              <Tag tone={skill.disabled ? 'neutral' : 'green'}>{t(skill.disabled ? 'skills.disabled' : 'skills.available')}</Tag>
            </article>)}
          </div>
        </section>)}
      </div>}
    </>}
  </section>;
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
}
