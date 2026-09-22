import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingV2 from '@/routes/LandingV2';
import { INDEXABLE_PATHS, metaEntries, pageSeo } from '@/lib/seo';
import { launchOffer } from '@/lib/launch-offer';

function mount() { return render(<MemoryRouter><LandingV2 /></MemoryRouter>); }

describe('independent landing concept', () => {
  beforeEach(() => localStorage.removeItem('jentera-landing-v2-theme'));
  afterEach(() => vi.restoreAllMocks());

  it('uses generated artwork instead of real product screenshots', () => {
    const { container } = mount();
    expect(container.querySelector('img[src*="product-tour"]')).toBeNull();
    expect(screen.getByAltText(/helping prepare work on a laptop/)).toHaveAttribute('src', '/images/jentera-landing-v2-hero-v1.webp');
    expect(screen.getByAltText(/presenting a supplier comparison/)).toHaveAttribute('src', '/images/jentera-landing-v2-result-v1.webp');
    expect(screen.getByText('Illustrative product concept')).toBeVisible();
  });

  it('persists the preview theme without changing the global app theme', async () => {
    const rootTheme = document.documentElement.getAttribute('data-theme');
    const rootClass = document.documentElement.className;
    const user = userEvent.setup();
    const first = mount();
    expect(first.container.querySelector('.lv2')).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(first.container.querySelector('.lv2')).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('jentera-landing-v2-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe(rootTheme);
    expect(document.documentElement.className).toBe(rootClass);
    first.unmount();
    const second = mount();
    expect(second.container.querySelector('.lv2')).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(second.container.querySelector('.lv2')).toHaveAttribute('data-theme', 'light');
  });

  it('still toggles when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    const { container } = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(container.querySelector('.lv2')).toHaveAttribute('data-theme', 'dark');
  });

  it('provides comparison and consistent real entry points without replacing the homepage', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pass je kerjadekat Jentera.');
    expect(screen.getByRole('link', { name: /Compare with the original/ })).toHaveAttribute('href', '/');
    for (const button of screen.getAllByRole('link', { name: 'Get started' })) expect(button).toHaveAttribute('href', launchOffer.href);
    expect(screen.getByRole('link', { name: 'See it in action' })).toHaveAttribute('href', '#v2-product');
    expect(screen.getByText(/bots share one dedicated business workspace/)).toBeVisible();
    expect(screen.queryByText(/Trusted by/)).toBeNull();
    expect(screen.getByText(/fictional example, not a customer result/)).toBeVisible();
  });

  it('keeps the preview out of search and retains its own title', () => {
    expect(INDEXABLE_PATHS as readonly string[]).not.toContain('/landing-v2');
    expect(pageSeo('/landing-v2')).toMatchObject({ indexable: false, canonical: null, title: 'Jentera — Landing design preview V2' });
    expect(metaEntries('/landing-v2')).toContainEqual({ attribute: 'name', key: 'robots', content: 'noindex, nofollow' });
  });

  it('offers working mobile navigation and dismisses it after an anchor selection', async () => {
    mount(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await user.click(screen.getAllByRole('link', { name: 'How it works' })[1]);
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
  });
});
