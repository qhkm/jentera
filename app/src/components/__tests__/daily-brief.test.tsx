import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyBrief } from '@/components/DailyBrief';
import { LocalRepository } from '@/lib/repo/local';
import { RepositoryProvider } from '@/lib/repo/context';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { ActivityState } from '@/hooks/useActivity';
import type { Activity, WorkSummary } from '@/lib/repo';

const now = new Date('2026-09-09T02:00:00Z');
const runId = '11111111-1111-4111-8111-111111111111';
const row: WorkSummary = { id: 'record', runId, status: 'completed', objective: 'Prepare a catering quotation', occurredAt: now.toISOString(), outcome: 'Draft prepared, not sent.', function: null, channel: null, subject: null, minutesSaved: null, outcomeQuality: null, qualityAt: null };
const data: Activity = { counters: { needsYou: 0, handled: 173, minutesSaved: 60, thisWeek: 2, connections: 1 }, work: [row] };
beforeEach(() => localStorage.clear());
async function mount(overrides: Partial<ActivityState> = {}, lang: 'en' | 'bm' = 'en') {
  const repo = new LocalRepository();
  await repo.setLang(lang);
  const snapshot = await repo.load();
  const navigate = vi.fn(), reload = vi.fn();
  render(<RepositoryProvider repository={repo}><I18nProvider>
    <DailyBrief now={now} snapshot={snapshot} onNavigate={navigate} activity={{ data, real: true, mode: 'real', loading: false, error: null, reload, updatedAt: now.getTime(), ...overrides }} />
  </I18nProvider></RepositoryProvider>);
  await screen.findByRole('heading', { name: lang === 'en' ? 'Your daily brief' : 'Ringkasan harian anda' });
  return { navigate, reload };
}

describe('daily business brief', () => {
  it('links today’s real work to its exact task and knowledge to the right business tab', async () => {
    const { navigate, reload } = await mount();
    await userEvent.click(screen.getByRole('button', { name: /Prepare a catering quotation/ }));
    expect(navigate).toHaveBeenLastCalledWith('work', undefined, runId);
    await userEvent.click(screen.getByRole('button', { name: 'Add business details' }));
    expect(navigate).toHaveBeenLastCalledWith('business', 'knows');
    expect(screen.queryByText('173')).not.toBeInTheDocument();
    expect(screen.getByText(/From recent work records/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('uses the approval count rather than guessing from recent records', async () => {
    const { navigate } = await mount({ data: { ...data, work: [], counters: { ...data.counters, needsYou: 3 } } });
    expect(screen.getByRole('heading', { name: 'Review 3 pending actions.' })).toBeInTheDocument();
    expect(screen.queryByText('No approvals waiting')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review pending actions' }));
    expect(navigate).toHaveBeenCalledWith('work', undefined, undefined);
  });
  it('opens a failed task without retrying work or approving anything', async () => {
    const { navigate } = await mount({ data: { ...data, work: [{ ...row, status: 'failed' }] } });
    await userEvent.click(screen.getByRole('button', { name: 'Check this task' }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('work', undefined, runId);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
  it('falls back to Activity for old records with no valid run ID', async () => {
    const { navigate } = await mount({ data: { ...data, work: [{ ...row, runId: '../activity' }] } });
    await userEvent.click(screen.getByRole('button', { name: /Prepare a catering quotation/ }));
    expect(navigate).toHaveBeenCalledWith('work', undefined, undefined);
  });
  it('does not show any cached figures, records, empty claims or timestamps while loading', async () => {
    await mount({ mode: 'pending', real: false, loading: true });
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.getByText('Putting your brief together…')).toBeInTheDocument();
    expect(screen.queryByText('No approvals waiting')).not.toBeInTheDocument();
    expect(screen.queryByText(row.objective)).not.toBeInTheDocument();
    expect(document.querySelector('.daily-brief-footer')).toBeNull();
  });
  it('shows a recoverable error, never an all-clear or cached work', async () => {
    const { reload } = await mount({ mode: 'error', real: false, error: new Error('offline') });
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot load your brief');
    expect(screen.queryByText(row.objective)).not.toBeInTheDocument();
    expect(screen.queryByText('No approvals waiting')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('keeps the brief compact and labels the record date without claiming a completed-today total', async () => {
    await mount({ data: { ...data, work: [row, { ...row, id: 'two', objective: 'Second job' }, { ...row, id: 'three', objective: 'Third job' }] } });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Recorded today')).toBeInTheDocument();
    expect(screen.queryByText('Third job')).not.toBeInTheDocument();
  });
  it('has Bahasa Malaysia copy for the brief and its actions', async () => {
    await mount({}, 'bm');
    expect(screen.getByRole('button', { name: 'Tambah butiran bisnes' })).toBeInTheDocument();
    expect(screen.getByText('Direkodkan hari ini')).toBeInTheDocument();
    expect(screen.getByText(/Waktu Malaysia/)).toBeInTheDocument();
  });
});
