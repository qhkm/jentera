import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { RuntimeOverview } from '@/lib/repo/types';
import { CreditUsageCard } from '@/components/CreditUsageCard';

/* 25 September, so the credits next reset on 1 October. */
const NOW = new Date('2026-09-25T04:00:00Z');

function overview(costMicrousd: number, runtimeMs = 0, canManage = true): RuntimeOverview {
  return {
    runtime: null,
    canManage,
    budget: {
      budget: { monthlyCostMicrousd: 5_000_000, monthlyRuntimeSeconds: 360_000 },
      usage: { costMicrousd, runtimeMs },
    },
  };
}

function mount(value: RuntimeOverview) {
  const repo = new LocalRepository();
  vi.spyOn(repo, 'runtimeStatus').mockResolvedValue(value);
  return render(<RepositoryProvider repository={repo}><I18nProvider>
    <CreditUsageCard now={NOW} />
  </I18nProvider></RepositoryProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe('this month’s AI credits, for the owner', () => {
  it('shows what is used of the month’s credits and when they reset', async () => {
    mount(overview(220_000));
    expect(await screen.findByText('US$0.22 of US$5.00 used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'This month’s AI credits' })).toHaveAttribute('aria-valuenow', '4');
    expect(screen.getByText('Resets on 1 October.')).toBeInTheDocument();
    expect(screen.queryByText(/hours of computer time/)).toBeNull();
  });

  it('turns amber from 80% and red from 95%', async () => {
    const { container, unmount } = mount(overview(4_100_000));
    await screen.findByText('US$4.10 of US$5.00 used');
    expect(container.querySelector('.credit-meter-warn')).not.toBeNull();
    unmount();
    const high = mount(overview(4_800_000));
    await screen.findByText('US$4.80 of US$5.00 used');
    expect(high.container.querySelector('.credit-meter-high')).not.toBeNull();
  });

  it('says so when computer time is nearer its cap than cost', async () => {
    mount(overview(100_000, 82 * 3_600_000));
    expect(await screen.findByText('82.0 of 100 hours of computer time used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '82');
  });

  it('shows nothing to staff, or where there are no real figures', async () => {
    const staff = mount(overview(220_000, 0, false));
    await new Promise((r) => setTimeout(r, 0));
    expect(staff.container).toBeEmptyDOMElement();
    staff.unmount();
    const demo = mount({ runtime: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(demo.container).toBeEmptyDOMElement();
  });
});
