import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import GoalsView from '../GoalsView';
import { HomeGoals } from '@/components/HomeGoals';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { Goal, Repository } from '@/lib/repo';
import { renderWithQuery, returnToApp } from '@/test-support/query';

const goal: Goal = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Reach 100 monthly orders',
  successCriteria: '100 paid orders in one calendar month',
  targetDate: '2026-12-31',
  status: 'active',
  taskCount: 3,
  completedTaskCount: 1,
  latestOutcome: 'Campaign brief ready for review',
  latestWorkAt: '2026-09-15T12:00:00.000Z',
  createdAt: '2026-09-15T10:00:00.000Z',
  updatedAt: '2026-09-15T12:00:00.000Z',
  completedAt: null,
  checkpoints: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      goalId: '11111111-1111-4111-8111-111111111111',
      title: 'Confirm the launch offer',
      status: 'completed',
      position: 0,
      taskCount: 1,
      completedTaskCount: 1,
      latestOutcome: 'Offer approved',
      latestWorkAt: '2026-09-15T11:00:00.000Z',
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-15T11:00:00.000Z',
      completedAt: '2026-09-15T11:00:00.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      goalId: '11111111-1111-4111-8111-111111111111',
      title: 'Prepare the sales campaign',
      status: 'todo',
      position: 1,
      taskCount: 0,
      completedTaskCount: 0,
      latestOutcome: null,
      latestWorkAt: null,
      createdAt: '2026-09-15T10:01:00.000Z',
      updatedAt: '2026-09-15T10:01:00.000Z',
      completedAt: null,
    },
  ],
};

function goalsRepo(canManage = true): Repository {
  const repo: Repository = new LocalRepository();
  repo.goals = vi.fn().mockResolvedValue({ canManage, goals: [goal] });
  repo.createGoal = vi.fn().mockResolvedValue(goal);
  repo.updateGoal = vi.fn().mockResolvedValue(undefined);
  repo.createGoalCheckpoint = vi.fn().mockResolvedValue(goal.checkpoints[1]);
  repo.updateGoalCheckpoint = vi.fn().mockResolvedValue(undefined);
  return repo;
}

/** The Goals screen, and with `home` Home's goal card beside it, in one
    signed-in cache (pass `client` to come back to an earlier one). */
async function mount(canManage = true, { repo = goalsRepo(canManage), home = false, client }: {
  repo?: Repository; home?: boolean; client?: QueryClient;
} = {}) {
  const onWork = vi.fn();
  const view = await renderWithQuery(<>
    {home && <HomeGoals onOpen={vi.fn()} />}
    <GoalsView onWork={onWork} />
  </>, { repository: repo, client });
  return { repo, onWork, user: userEvent.setup(), client: view.client, unmount: view.unmount };
}

const homeCard = () => within(document.querySelector<HTMLElement>('.home-goals')!);

describe('Goals', () => {
  it('shows measurable work evidence and starts work in a linked chat', async () => {
    const { onWork, user } = await mount();
    expect(await screen.findByRole('heading', { name: goal.title })).toBeVisible();
    expect(screen.getByText('1 of 3 linked tasks completed')).toBeVisible();
    expect(screen.getByText('1 of 2 steps complete')).toBeVisible();
    expect(screen.getByText(/Next step/)).toBeVisible();
    expect(screen.getByText(goal.latestOutcome!)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Work on this goal' }));
    expect(onWork).toHaveBeenCalledWith(goal);
  });

  it('adds a step, changes its status, and opens a checkpoint-linked chat', async () => {
    const { repo, onWork, user } = await mount();
    await screen.findByRole('heading', { name: goal.title });
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Step'), 'Contact the first 20 customers');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(repo.createGoalCheckpoint).toHaveBeenCalledWith(
      goal.id,
      'Contact the first 20 customers',
    ));

    await user.selectOptions(
      screen.getByLabelText('Status for step: Prepare the sales campaign'),
      'working',
    );
    await waitFor(() => expect(repo.updateGoalCheckpoint).toHaveBeenCalledWith(
      goal.id,
      goal.checkpoints[1].id,
      { title: goal.checkpoints[1].title, status: 'working' },
    ));
    await user.click(screen.getByRole('button', { name: 'Work on step' }));
    expect(onWork).toHaveBeenLastCalledWith(goal, goal.checkpoints[1]);
  });

  it('lets an owner define the outcome and success criteria', async () => {
    const { repo, user } = await mount();
    await screen.findByRole('heading', { name: goal.title });
    await user.click(screen.getByRole('button', { name: 'Add goal' }));
    await user.type(screen.getByLabelText('Goal'), 'Launch catering service');
    await user.type(screen.getByLabelText('Success criteria'), 'First 10 paid catering orders');
    await user.type(screen.getByLabelText('Target date (optional)'), '2027-01-15');
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    await waitFor(() => expect(repo.createGoal).toHaveBeenCalledWith({
      title: 'Launch catering service',
      successCriteria: 'First 10 paid catering orders',
      targetDate: '2027-01-15',
    }));
  });

  it('lets staff work toward goals without exposing management controls', async () => {
    const { user, onWork } = await mount(false);
    await screen.findByRole('heading', { name: goal.title });
    expect(screen.queryByRole('button', { name: 'Add goal' })).toBeNull();
    expect(screen.queryByRole('button', { name: `Edit ${goal.title}` })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Work on this goal' }));
    expect(onWork).toHaveBeenCalledOnce();
  });

  it('reads the goals once for the Home card and the Goals screen together', async () => {
    const { repo } = await mount(true, { home: true });
    expect(await screen.findByRole('heading', { name: goal.title })).toBeVisible();
    expect(homeCard().getByText(goal.title)).toBeVisible();
    expect(repo.goals).toHaveBeenCalledTimes(1);
  });

  it('shows the goals again on a return inside 30 s without asking the server', async () => {
    const first = await mount();
    expect(await screen.findByRole('heading', { name: goal.title })).toBeVisible();
    first.unmount();
    await mount(true, { repo: first.repo, client: first.client });
    expect(screen.getByRole('heading', { name: goal.title })).toBeVisible();
    expect(first.repo.goals).toHaveBeenCalledTimes(1);
  });

  it('brings a saved change to the Home card as well', async () => {
    const repo = goalsRepo();
    const renamed = { ...goal, title: 'Reach 150 monthly orders' };
    repo.goals = vi.fn().mockResolvedValueOnce({ canManage: true, goals: [goal] })
      .mockResolvedValue({ canManage: true, goals: [renamed] });
    const { user } = await mount(true, { repo, home: true });
    await user.click(await screen.findByRole('button', { name: `Edit ${goal.title}` }));
    await user.clear(screen.getByLabelText('Goal'));
    await user.type(screen.getByLabelText('Goal'), renamed.title);
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(await homeCard().findByText(renamed.title)).toBeVisible();
    expect(screen.getByRole('heading', { name: renamed.title })).toBeVisible();
  });

  it('keeps the goals on screen when reading them again fails', async () => {
    const repo = goalsRepo();
    repo.goals = vi.fn().mockResolvedValueOnce({ canManage: true, goals: [goal] })
      .mockRejectedValue(new Error('down'));
    const { client, user } = await mount(true, { repo });
    await screen.findByRole('heading', { name: goal.title });
    await user.selectOptions(screen.getByLabelText('Status for step: Prepare the sales campaign'), 'working');
    await waitFor(() => expect(repo.goals).toHaveBeenCalledTimes(2));
    await returnToApp(client);
    await waitFor(() => expect(repo.goals).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('heading', { name: goal.title })).toBeVisible();
    expect(screen.queryByText('Your goals could not be loaded.')).toBeNull();
  });

  it('says so when the goals cannot be read at all, and tries again', async () => {
    const repo = goalsRepo();
    repo.goals = vi.fn().mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ canManage: true, goals: [goal] });
    const { user } = await mount(true, { repo });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: goal.title })).toBeVisible();
  });

  it('asks for nothing outside a signed-in cache', async () => {
    const repo = goalsRepo();
    render(<RepositoryProvider repository={repo}><I18nProvider><GoalsView onWork={vi.fn()} /></I18nProvider></RepositoryProvider>);
    expect(await screen.findByText('No goals yet')).toBeVisible();
    expect(repo.goals).not.toHaveBeenCalled();
  });
});
