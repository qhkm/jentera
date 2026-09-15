import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import GoalsView from '../GoalsView';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { Goal, Repository } from '@/lib/repo';

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
};

function mount(canManage = true) {
  const repo: Repository = new LocalRepository();
  repo.goals = vi.fn().mockResolvedValue({ canManage, goals: [goal] });
  repo.createGoal = vi.fn().mockResolvedValue(goal);
  repo.updateGoal = vi.fn().mockResolvedValue(undefined);
  const onWork = vi.fn();
  render(<RepositoryProvider repository={repo}><I18nProvider><GoalsView onWork={onWork} /></I18nProvider></RepositoryProvider>);
  return { repo, onWork, user: userEvent.setup() };
}

describe('Goals', () => {
  it('shows measurable work evidence and starts work in a linked chat', async () => {
    const { onWork, user } = mount();
    expect(await screen.findByRole('heading', { name: goal.title })).toBeVisible();
    expect(screen.getByText('1 of 3 linked tasks completed')).toBeVisible();
    expect(screen.getByText(goal.latestOutcome!)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Work on this goal' }));
    expect(onWork).toHaveBeenCalledWith(goal);
  });

  it('lets an owner define the outcome and success criteria', async () => {
    const { repo, user } = mount();
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
    const { user, onWork } = mount(false);
    await screen.findByRole('heading', { name: goal.title });
    expect(screen.queryByRole('button', { name: 'Add goal' })).toBeNull();
    expect(screen.queryByRole('button', { name: `Edit ${goal.title}` })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Work on this goal' }));
    expect(onWork).toHaveBeenCalledOnce();
  });
});
