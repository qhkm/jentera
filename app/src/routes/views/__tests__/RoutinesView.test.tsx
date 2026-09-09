import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { RoutineError } from '@/lib/routines/api';
import type { Routine, RoutineAction, RoutineList, RoutineWriteResult, RoutinesApi } from '@/lib/routines/types';
import { ROUTINE_ID, RUN_ID, historyFixture, listFixture, occurrenceFixture, routineFixture } from '@/lib/routines/__tests__/fixtures';
import RoutinesView from '../RoutinesView';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function fixture(initial: Routine[] = []) {
  let list = listFixture(initial);
  let history = historyFixture();
  const api = {
    list: vi.fn(async () => structuredClone(list)),
    read: vi.fn(async (id: string) => {
      const found = list.routines.find((r) => r.id === id);
      if (!found) throw new RoutineError('ROUTINE_NOT_FOUND', 404);
      return structuredClone(found);
    }),
    occurrences: vi.fn(async () => structuredClone(history)),
    execute: vi.fn(async (action: RoutineAction): Promise<RoutineWriteResult> => {
      if (action.kind === 'run') {
        const occurrence = occurrenceFixture({ trigger: 'manual' });
        history = historyFixture([occurrence]);
        return { occurrence };
      }
      let result: Routine;
      if (action.kind === 'create') {
        const { requestId: _requestId, enabled, ...config } = action.body;
        result = routineFixture({ ...config, status: enabled ? 'active' : 'paused', nextRunAt: enabled ? '2026-09-10T00:00:00.000Z' : null });
        list.routines.push(result);
      } else {
        const previous = list.routines.find((r) => r.id === action.id)!;
        if (previous.revision !== action.body.expectedRevision) throw new RoutineError('REVISION_CONFLICT', 409);
        result = action.kind === 'state' ? { ...previous, status: action.body.status, nextRunAt: action.body.status === 'paused' ? null : previous.nextRunAt, revision: previous.revision + 1 }
          : { ...previous, name: action.body.name, task: action.body.task, schedule: action.body.schedule, revision: previous.revision + 1 };
        list.routines = list.routines.map((r) => r.id === result.id ? result : r);
      }
      return { routine: structuredClone(result) };
    }),
  } satisfies RoutinesApi;
  return { api, setList: (next: RoutineList) => { list = next; }, setHistory: (next: ReturnType<typeof historyFixture>) => { history = next; } };
}

async function mount(api: RoutinesApi, selected: string | null = null, lang: 'en' | 'bm' = 'en') {
  const repo = new LocalRepository();
  await repo.setLang(lang);
  const openTask = vi.fn();
  function Harness() {
    const [id, setId] = useState(selected);
    const [active, setActive] = useState(true);
    return <><button onClick={() => setActive(!active)}>Switch mode</button><output data-testid="mode">{active ? 'routines' : 'chat'}</output>
      <div hidden={!active}><RoutinesView api={api} active={active} selectedId={id} onSelect={setId} onOpenTask={openTask} /></div></>;
  }
  render(<MemoryRouter><RepositoryProvider repository={repo}><I18nProvider><Harness /></I18nProvider></RepositoryProvider></MemoryRouter>);
  await screen.findByRole('heading', { name: lang === 'en' ? 'Routines' : 'Rutin' });
  return { user: userEvent.setup(), openTask };
}

async function startCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Business summary.*Set this up/ }));
  await user.click(screen.getByRole('button', { name: 'Review schedule' }));
}

describe('routine creation and confirmation', () => {
  it('reviews before creating and reads the authoritative record after saving', async () => {
    const { api } = fixture();
    const { user } = await mount(api);
    await startCreate(user);
    expect(api.execute).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Check before saving' })).toHaveFocus();
    expect(screen.getByText(/Saving does not run the job now/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate routine' }));
    await screen.findByRole('heading', { name: 'Run history' });
    expect(api.execute).toHaveBeenCalledOnce();
    expect(api.execute.mock.calls[0][0]).toMatchObject({ kind: 'create', body: { enabled: true, name: 'Morning business summary', schedule: { frequency: 'weekdays', time: '08:00', timeZone: 'Asia/Kuala_Lumpur' } } });
    expect(api.read).toHaveBeenCalledWith(ROUTINE_ID);
  });

  it('saves paused, handles weekly day changes, and removes weekday when changing frequency', async () => {
    const { api } = fixture();
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: /Weekly review.*Set this up/ }));
    await user.selectOptions(screen.getByLabelText('Day'), '7');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
    expect(screen.queryByLabelText('Day')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Review schedule' }));
    await user.click(screen.getByRole('button', { name: 'Save paused routine' }));
    await screen.findByRole('heading', { name: 'Run history' });
    const action = api.execute.mock.calls[0][0];
    expect(action.body).toMatchObject({ enabled: false, schedule: { frequency: 'daily' } });
    expect((action.body as { schedule: object }).schedule).not.toHaveProperty('weekday');
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('blocks duplicate submissions, keeps the key after a lost reply and retries only that request', async () => {
    const { api } = fixture([routineFixture({ status: 'paused', nextRunAt: null })]);
    let reject!: (e: Error) => void;
    api.execute.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const { user } = await mount(api, ROUTINE_ID);
    await user.click(await screen.findByRole('button', { name: 'Run once' }));
    await user.click(screen.getByRole('button', { name: 'Run once now' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => reject(new RoutineError('NETWORK', 0, true)));
    const retry = await screen.findByRole('button', { name: 'Retry the same request' });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(api.execute).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Switch mode' }));
    await user.click(screen.getByRole('button', { name: 'Switch mode' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry the same request' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Retry the same request' }));
    await screen.findByText('The run is recorded. Check its status and result below.');
    expect(api.execute.mock.calls[0][0]).toEqual(api.execute.mock.calls[1][0]);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('does not navigate away from Chat when a pending save finishes', async () => {
    const { api } = fixture();
    let finish!: (result: RoutineWriteResult) => void;
    api.execute.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { user } = await mount(api);
    await startCreate(user);
    await user.click(screen.getByRole('button', { name: 'Activate routine' }));
    await user.click(screen.getByRole('button', { name: 'Switch mode' }));
    await act(async () => finish({ routine: routineFixture() }));
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
    expect(api.execute).toHaveBeenCalledOnce();
  });
});

describe('permissions, history and failures', () => {
  it('allows an owner to pause while scheduling is unavailable, but not edit, resume or run', async () => {
    const { api, setList } = fixture();
    const list = listFixture([routineFixture()]);
    list.capabilities.canSchedule = false; list.capabilities.canRunNow = false;
    setList(list);
    const { user } = await mount(api, ROUTINE_ID);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause routine' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Edit schedule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run once' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Pause routine' }));
    const confirm = screen.getByRole('region', { name: 'Pause routine' });
    expect(within(confirm).getByText(/including queued work, may still finish/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Pause routine' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume routine' })).toBeDisabled());
  });

  it('keeps staff read-only and shows no fabricated schedules in an empty account', async () => {
    const { api, setList } = fixture();
    const list = listFixture(); list.capabilities.canManage = false; setList(list);
    await mount(api);
    await screen.findByText('No routines set up yet. An owner can add one here.');
    expect(screen.queryByRole('button', { name: 'Add a routine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set this up/ })).not.toBeInTheDocument();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('reconciles a revision conflict without overwriting another owner’s change', async () => {
    const { api, setList } = fixture([routineFixture()]);
    const { user } = await mount(api, ROUTINE_ID);
    await user.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    await user.clear(screen.getByLabelText('Routine name'));
    await user.type(screen.getByLabelText('Routine name'), 'My changed name');
    await user.click(screen.getByRole('button', { name: 'Review schedule' }));
    setList(listFixture([routineFixture({ name: 'Changed elsewhere', revision: 2 })]));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/This routine has changed since/);
    expect(api.execute).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Check latest records' }));
    expect(await screen.findByRole('heading', { name: 'Changed elsewhere' })).toBeInTheDocument();
    expect(api.execute).toHaveBeenCalledOnce();
  });

  it('shows skipped reasons and neutral unknown states, paginates and opens an exact run', async () => {
    const { api, setHistory } = fixture([routineFixture()]);
    const history = historyFixture([occurrenceFixture({ status: 'skipped', runId: null, reason: 'nothing_pending', summary: null })]);
    history.nextCursor = 'next'; setHistory(history);
    const { user, openTask } = await mount(api, ROUTINE_ID);
    await screen.findByText('No approvals were waiting. No reminder was needed.');
    expect(screen.queryByRole('button', { name: 'View task' })).not.toBeInTheDocument();
    setHistory(historyFixture([occurrenceFixture({ id: RUN_ID, status: 'future_state' })]));
    await user.click(screen.getByRole('button', { name: 'Load earlier runs' }));
    const status = await screen.findByText('Status unavailable');
    expect(status).not.toHaveClass('routine-status-good');
    expect(api.occurrences).toHaveBeenLastCalledWith(ROUTINE_ID, 'next');
    await user.click(screen.getByRole('button', { name: 'View task' }));
    expect(openTask).toHaveBeenCalledWith(RUN_ID);
  });

  it('does not treat an unversioned service error as an empty account', async () => {
    const { api } = fixture(); api.list.mockRejectedValue(new RoutineError('REQUEST_FAILED', 503));
    await mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load routines.');
    expect(screen.queryByRole('button', { name: /Set this up/ })).not.toBeInTheDocument();
  });

  it('hides creation at the server-advertised cap and displays BM copy', async () => {
    const { api, setList } = fixture(); const list = listFixture([routineFixture()]); list.capabilities.maxRoutines = 1; setList(list);
    await mount(api, null, 'bm');
    await screen.findByText(/mencapai had 1 rutin/);
    expect(screen.queryByRole('button', { name: 'Tambah rutin' })).not.toBeInTheDocument();
    expect(screen.getByText(/Waktu Malaysia/)).toBeInTheDocument();
  });
});
