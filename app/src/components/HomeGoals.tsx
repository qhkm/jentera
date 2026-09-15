import { ArrowUpRight, CheckCircle, Target } from '@phosphor-icons/react';
import { Card, Eyebrow } from '@/components/ui';
import { useGoals } from '@/hooks/useGoals';
import { useI18n } from '@/i18n/I18nProvider';

export function HomeGoals({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const state = useGoals();
  const active = state.goals.filter((goal) => goal.status === 'active');
  const focus = active[0];
  const checkpointDone = focus?.checkpoints.filter((checkpoint) => checkpoint.status === 'completed').length ?? 0;
  const nextCheckpoint = focus?.checkpoints.find((checkpoint) => checkpoint.status !== 'completed');
  return <Card className="home-goals">
    <div className="home-goals-icon" aria-hidden="true"><Target size={22} weight="duotone" /></div>
    <div className="home-goals-copy">
      <Eyebrow>{t('goals.home.eyebrow')}</Eyebrow>
      <strong>{focus?.title ?? t(state.loading ? 'goals.loading' : state.error ? 'goals.home.error' : 'goals.home.empty')}</strong>
      {focus ? <span>
        {focus.checkpoints.length
          ? t('goals.checkpoints.progress', { done: checkpointDone, total: focus.checkpoints.length })
          : focus.taskCount
            ? t('goals.progress', { done: focus.completedTaskCount, total: focus.taskCount })
            : t('goals.noWork')}
        {nextCheckpoint ? ` · ${t('goals.checkpoint.nextNamed', { title: nextCheckpoint.title })}` : ''}
        {active.length > 1 ? ` · ${t('goals.more', { n: active.length - 1 })}` : ''}
      </span> : !state.loading ? <span>{t(state.error ? 'goals.home.error.detail' : 'goals.home.empty.detail')}</span> : null}
    </div>
    {focus?.taskCount && focus.completedTaskCount === focus.taskCount ? <CheckCircle className="home-goals-check" size={18} weight="fill" aria-hidden="true" /> : null}
    <button type="button" onClick={onOpen} aria-label={t('goals.open')}>
      <span>{t('goals.open')}</span><ArrowUpRight size={18} aria-hidden="true" />
    </button>
  </Card>;
}
