import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComputerSetupProgress } from '@/components/ComputerSetupProgress';
vi.mock('@/i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en' }) }));
describe('setup progress', () => {
  it('uses confirmed stages and holds the percentage when the estimate overruns', () => {
    const progress = { stage: 'npm', startedAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:01:00Z' };
    const { rerender } = render(<ComputerSetupProgress progress={progress} now={Date.parse('2026-09-13T00:02:00Z')} />);
    expect(screen.getByText('Installing apps')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '38');
    expect(screen.getByText(/Rough estimate/)).toBeInTheDocument();
    rerender(<ComputerSetupProgress progress={progress} now={Date.parse('2026-09-13T00:10:00Z')} />);
    expect(screen.getByText(/Taking longer than expected/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '38');
  });
  it('does not show a made-up percentage for unknown stages', () => {
    render(<ComputerSetupProgress progress={{ stage: 'unknown', startedAt: '', updatedAt: '' }} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
