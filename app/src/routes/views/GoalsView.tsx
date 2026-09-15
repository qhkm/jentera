import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CalendarBlank,
  Check,
  CheckCircle,
  Circle,
  PencilSimple,
  Plus,
  Target,
  X,
} from '@phosphor-icons/react';
import { Button, Card, Eyebrow, LoadingState } from '@/components/ui';
import { useGoals } from '@/hooks/useGoals';
import { useI18n } from '@/i18n/I18nProvider';
import { useRepository, type Goal, type GoalCheckpoint, type GoalCheckpointStatus, type GoalInput, type GoalStatus } from '@/lib/repo';
import { malaysiaDay } from '@/lib/daily-brief';

type Editor = GoalInput & { id?: string; status: GoalStatus };
const blank = (): Editor => ({ title: '', successCriteria: '', targetDate: null, status: 'active' });

function fields(goal: Goal): Editor {
  return {
    id: goal.id,
    title: goal.title,
    successCriteria: goal.successCriteria ?? '',
    targetDate: goal.targetDate,
    status: goal.status,
  };
}

export default function GoalsView({ onWork }: { onWork: (goal: Goal, checkpoint?: GoalCheckpoint) => void }) {
  const { t, lang } = useI18n();
  const repo = useRepository();
  const goals = useGoals();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState('');
  const [editingStep, setEditingStep] = useState<{ goalId: string; id: string; title: string } | null>(null);
  const active = goals.goals.filter((goal) => goal.status === 'active');
  const completed = goals.goals.filter((goal) => goal.status === 'completed');
  const today = malaysiaDay(new Date());

  const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(
    lang === 'bm' ? 'ms-MY' : 'en-MY',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || saving) return;
    const input = {
      title: editor.title.trim(),
      successCriteria: editor.successCriteria.trim(),
      targetDate: editor.targetDate,
    };
    if (!input.title || input.title.length > 120 || !input.successCriteria || input.successCriteria.length > 1000) {
      setError(t('goals.validation'));
      return;
    }
    setSaving(true); setError('');
    try {
      if (editor.id && repo.updateGoal) await repo.updateGoal(editor.id, { ...input, status: editor.status });
      else if (!editor.id && repo.createGoal) await repo.createGoal(input);
      else throw new Error('Goals are unavailable');
      setEditor(null);
      await goals.reload().catch(() => undefined);
    } catch {
      setError(t('goals.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(goal: Goal, status: 'active' | 'completed') {
    if (!repo.updateGoal) return;
    setSaving(true); setError('');
    try {
      await repo.updateGoal(goal.id, {
        title: goal.title,
        successCriteria: goal.successCriteria ?? '',
        targetDate: goal.targetDate,
        status,
      });
      await goals.reload().catch(() => undefined);
    } catch {
      setError(t('goals.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function addCheckpoint(event: FormEvent, goalId: string) {
    event.preventDefault();
    const title = stepDraft.trim();
    if (!title || title.length > 160 || !repo.createGoalCheckpoint) {
      setError(t('goals.checkpoint.validation'));
      return;
    }
    setSaving(true); setError('');
    try {
      await repo.createGoalCheckpoint(goalId, title);
      setAddingTo(null); setStepDraft('');
      await goals.reload().catch(() => undefined);
    } catch {
      setError(t('goals.checkpoint.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function updateCheckpoint(goal: Goal, checkpoint: GoalCheckpoint, input: {
    title: string;
    status: GoalCheckpointStatus;
  }) {
    if (!repo.updateGoalCheckpoint || saving) return;
    setSaving(true); setError('');
    try {
      await repo.updateGoalCheckpoint(goal.id, checkpoint.id, input);
      setEditingStep(null);
      await goals.reload().catch(() => undefined);
    } catch {
      setError(t('goals.checkpoint.saveError'));
    } finally {
      setSaving(false);
    }
  }

  function stepIcon(status: GoalCheckpointStatus) {
    return status === 'completed'
      ? <CheckCircle size={18} weight="fill" aria-hidden="true" />
      : <Circle size={18} weight={status === 'working' ? 'duotone' : 'regular'} aria-hidden="true" />;
  }

  const card = (goal: Goal) => <li key={goal.id}>
    <Card className={`goal-card ${goal.status === 'completed' ? 'goal-card-completed' : ''}`}>
      <header>
        <span className="goal-mark" aria-hidden="true">
          {goal.status === 'completed' ? <CheckCircle size={22} weight="fill" /> : <Target size={22} weight="duotone" />}
        </span>
        <div>
          <h2>{goal.title}</h2>
          <span className="goal-status">{t(`goals.status.${goal.status}`)}</span>
        </div>
        {goals.canManage && <button type="button" className="goal-edit" onClick={() => setEditor(fields(goal))} aria-label={t('goals.editNamed', { title: goal.title })}>
          <PencilSimple size={17} aria-hidden="true" />
        </button>}
      </header>
      {goal.successCriteria && <p className="goal-success"><span>{t('goals.success')}</span>{goal.successCriteria}</p>}
      <section className="goal-plan" aria-label={t('goals.plan')}>
        <header>
          <strong>{t('goals.plan')}</strong>
          <span>{goal.checkpoints.length
            ? t('goals.checkpoints.progress', {
                done: goal.checkpoints.filter((checkpoint) => checkpoint.status === 'completed').length,
                total: goal.checkpoints.length,
              })
            : t('goals.checkpoints.empty')}</span>
        </header>
        {goal.checkpoints.length > 0 && <ol>
          {goal.checkpoints.map((checkpoint, index) => {
            const next = index === goal.checkpoints.findIndex((candidate) => candidate.status !== 'completed');
            return <li key={checkpoint.id} className={`goal-checkpoint goal-checkpoint-${checkpoint.status}`}>
              <span className="goal-checkpoint-mark">{stepIcon(checkpoint.status)}</span>
              <div className="goal-checkpoint-copy">
                {editingStep?.id === checkpoint.id ? <form onSubmit={(event) => {
                  event.preventDefault();
                  const title = editingStep.title.trim();
                  if (!title || title.length > 160) { setError(t('goals.checkpoint.validation')); return; }
                  void updateCheckpoint(goal, checkpoint, { title, status: checkpoint.status });
                }}>
                  <input className="input" autoFocus maxLength={160} aria-label={t('goals.checkpoint.editNamed', { title: checkpoint.title })} value={editingStep.title} onChange={(event) => setEditingStep({ ...editingStep, title: event.target.value })} />
                  <button type="submit" disabled={saving}><Check size={15} aria-hidden="true" /><span className="sr-only">{t('goals.save')}</span></button>
                  <button type="button" onClick={() => setEditingStep(null)}><X size={15} aria-hidden="true" /><span className="sr-only">{t('goals.cancel')}</span></button>
                </form> : <strong>{checkpoint.title}</strong>}
                <span>
                  {next ? `${t('goals.checkpoint.next')} · ` : ''}
                  {checkpoint.taskCount
                    ? t('goals.progress', { done: checkpoint.completedTaskCount, total: checkpoint.taskCount })
                    : t(`goals.checkpoint.status.${checkpoint.status}`)}
                </span>
                {checkpoint.latestOutcome && <small>{checkpoint.latestOutcome}</small>}
              </div>
              <div className="goal-checkpoint-actions">
                {goal.status === 'active' && checkpoint.status !== 'completed' && <button type="button" onClick={() => onWork(goal, checkpoint)}>{t('goals.checkpoint.work')}<ArrowRight size={14} aria-hidden="true" /></button>}
                {goals.canManage && editingStep?.id !== checkpoint.id && <button type="button" onClick={() => setEditingStep({ goalId: goal.id, id: checkpoint.id, title: checkpoint.title })} aria-label={t('goals.checkpoint.editNamed', { title: checkpoint.title })}><PencilSimple size={15} aria-hidden="true" /></button>}
                {goals.canManage && <select value={checkpoint.status} disabled={saving} aria-label={t('goals.checkpoint.statusNamed', { title: checkpoint.title })} onChange={(event) => void updateCheckpoint(goal, checkpoint, { title: checkpoint.title, status: event.target.value as GoalCheckpointStatus })}>
                  {(['todo', 'working', 'blocked', 'completed'] as const).map((status) => <option key={status} value={status}>{t(`goals.checkpoint.status.${status}`)}</option>)}
                </select>}
              </div>
            </li>;
          })}
        </ol>}
        {goals.canManage && goal.status === 'active' && (addingTo === goal.id ? <form className="goal-add-checkpoint" onSubmit={(event) => void addCheckpoint(event, goal.id)}>
          <input className="input" autoFocus required maxLength={160} aria-label={t('goals.checkpoint.name')} placeholder={t('goals.checkpoint.placeholder')} value={stepDraft} onChange={(event) => setStepDraft(event.target.value)} />
          <Button type="submit" disabled={saving || !stepDraft.trim()}>{t('goals.checkpoint.add')}</Button>
          <Button type="button" variant="ghost" onClick={() => { setAddingTo(null); setStepDraft(''); }}>{t('goals.cancel')}</Button>
        </form> : <button type="button" className="goal-add-checkpoint-trigger" onClick={() => { setAddingTo(goal.id); setStepDraft(''); }}><Plus size={15} aria-hidden="true" />{t('goals.checkpoint.add')}</button>)}
      </section>
      <div className="goal-evidence">
        <span>{goal.taskCount ? t('goals.progress', { done: goal.completedTaskCount, total: goal.taskCount }) : t('goals.noWork')}</span>
        {goal.targetDate && <time dateTime={goal.targetDate} className={goal.status === 'active' && goal.targetDate < today ? 'goal-overdue' : ''}>
          <CalendarBlank size={15} aria-hidden="true" />
          {t(goal.status === 'active' && goal.targetDate < today ? 'goals.overdue' : 'goals.target', { date: date(goal.targetDate) })}
        </time>}
      </div>
      {goal.latestOutcome && <p className="goal-latest"><span>{t('goals.latest')}</span>{goal.latestOutcome}</p>}
      <footer>
        {goal.status === 'active' && <Button onClick={() => onWork(goal)}>
          {t('goals.work')}<ArrowRight size={16} aria-hidden="true" />
        </Button>}
        {goals.canManage && <Button variant="ghost" disabled={saving} onClick={() => void changeStatus(goal, goal.status === 'active' ? 'completed' : 'active')}>
          {goal.status === 'active' ? <Check size={16} aria-hidden="true" /> : null}
          {t(goal.status === 'active' ? 'goals.complete' : 'goals.reopen')}
        </Button>}
      </footer>
    </Card>
  </li>;

  return <section className="goals-view" aria-labelledby="goals-heading">
    <header className="goal-page-heading">
      <div><Eyebrow>{t('goals.eyebrow')}</Eyebrow><h1 id="goals-heading">{t('goals.title')}</h1><p>{t('goals.intro')}</p></div>
      {goals.canManage && !editor && <Button onClick={() => setEditor(blank())}><Plus size={17} aria-hidden="true" />{t('goals.add')}</Button>}
    </header>

    {error && <p className="goal-error" role="alert">{error}</p>}
    {editor && <form className="goal-editor card" onSubmit={(event) => void save(event)}>
      <div className="goal-editor-heading"><h2>{t(editor.id ? 'goals.edit' : 'goals.new')}</h2><button type="button" onClick={() => { setEditor(null); setError(''); }} aria-label={t('goals.cancel')}><X size={18} /></button></div>
      <label>{t('goals.name')}<input className="input" aria-label={t('goals.name')} required maxLength={120} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
      <label>{t('goals.criteria')}<textarea className="input" aria-label={t('goals.criteria')} required rows={4} maxLength={1000} value={editor.successCriteria} onChange={(event) => setEditor({ ...editor, successCriteria: event.target.value })} /><span>{t('goals.criteria.help')}</span></label>
      <label className="goal-date-field">{t('goals.date')}<input className="input" aria-label={t('goals.date')} type="date" value={editor.targetDate ?? ''} onChange={(event) => setEditor({ ...editor, targetDate: event.target.value || null })} /></label>
      <div className="goal-editor-actions"><Button type="submit" disabled={saving}>{t(saving ? 'goals.saving' : 'goals.save')}</Button><Button type="button" variant="ghost" onClick={() => setEditor(null)}>{t('goals.cancel')}</Button></div>
    </form>}

    {goals.loading ? <Card><LoadingState title={t('goals.loading')} /></Card>
      : goals.error ? <Card className="goal-empty"><strong>{t('goals.loadError')}</strong><Button variant="outline" onClick={() => void goals.reload().catch(() => undefined)}>{t('loading.retry')}</Button></Card>
        : active.length === 0 && completed.length === 0 && !editor ? <Card className="goal-empty"><Target size={30} weight="duotone" /><strong>{t('goals.empty')}</strong><p>{t('goals.empty.detail')}</p>{goals.canManage && <Button onClick={() => setEditor(blank())}>{t('goals.addFirst')}</Button>}</Card>
          : <>
            {active.length > 0 && <div className="goal-group"><h2>{t('goals.active')}</h2><ul>{active.map(card)}</ul></div>}
            {completed.length > 0 && <div className="goal-group"><h2>{t('goals.completed')}</h2><ul>{completed.map(card)}</ul></div>}
          </>}
  </section>;
}
