import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  initialWorkspaceV3,
  WORKSPACE_V3_KEY,
  WorkspaceDesignToggle,
} from '@/components/WorkspaceDesignToggle';

describe('WorkspaceDesignToggle', () => {
  beforeEach(() => localStorage.clear());

  it('always starts with the V1 workspace and clears the retired saved preview', () => {
    expect(initialWorkspaceV3()).toBe(false);
    localStorage.setItem(WORKSPACE_V3_KEY, 'v3');
    expect(initialWorkspaceV3()).toBe(false);
    expect(localStorage.getItem(WORKSPACE_V3_KEY)).toBeNull();
  });

  it('keeps the reversible V3 preview session-only', async () => {
    let enabled = false;
    const view = render(
      <WorkspaceDesignToggle enabled={enabled} onChange={(next) => { enabled = next; }} />,
    );
    const button = screen.getByRole('button', { name: 'Preview the V3 workspace design' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(enabled).toBe(true);
    expect(localStorage.getItem(WORKSPACE_V3_KEY)).toBeNull();

    view.rerender(<WorkspaceDesignToggle enabled onChange={(next) => { enabled = next; }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use the current workspace design' }));
    expect(enabled).toBe(false);
    expect(localStorage.getItem(WORKSPACE_V3_KEY)).toBeNull();
  });
});
