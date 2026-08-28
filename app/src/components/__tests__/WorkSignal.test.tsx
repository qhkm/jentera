import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveWorkCard, OutcomeReceipt, WorkStatusBar } from '@/components/WorkSignal';

describe('real work signals', () => {
  it('announces the current phase and keeps the audience visible', () => {
    const { container } = render(
      <WorkStatusBar state="working" title="Jentera is working" audience="Private" />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Jentera is working');
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(container.querySelector('.work-pulse-working')).not.toBeNull();
  });

  it('shows progress as real named phases', () => {
    render(
      <LiveWorkCard
        state="waking"
        title="Starting securely"
        detail="Waking your private agent"
        audience="Private"
        steps={[
          { label: 'Request received', state: 'done' },
          { label: 'Private agent ready', state: 'active' },
          { label: 'Handling the task', state: 'next' },
        ]}
      />,
    );

    expect(screen.getByRole('article', { name: 'Starting securely' })).toBeInTheDocument();
    expect(screen.getByText('Private agent ready')).toBeInTheDocument();
  });

  it('turns completed work into an actionable evidence receipt', () => {
    const openActivity = vi.fn();
    render(
      <OutcomeReceipt
        title="Work complete"
        outcome="Prepared the weekly update."
        audience="Private workspace"
        evidence="Used 3 confirmed business facts"
        statusLabel="Done"
        actionLabel="View in Activity"
        onAction={openActivity}
      />,
    );

    expect(screen.getByText('Used 3 confirmed business facts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View in Activity' }));
    expect(openActivity).toHaveBeenCalledOnce();
  });
});
