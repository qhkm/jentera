import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Landing from '@/routes/Landing';
import { BUSINESS_EXAMPLES } from '@/lib/landing-content';

function mount() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe('Jentera landing experience', () => {
  it('offers account creation and a clearly labelled local-business illustration', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You built the business.');
    for (const link of screen.getAllByRole('link', { name: /put jentera to work/i })) {
      expect(link).toHaveAttribute('href', '/signin?mode=signup');
    }
    expect(
      screen.getByText(/An illustration. Your work uses the details you confirm./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /try the setup without an account/i })).toHaveAttribute(
      'href',
      '/onboard',
    );
  });

  it('switches examples and restores keyboard focus when returning from a draft', async () => {
    const user = userEvent.setup();
    mount();
    const openDraft = () => screen.getByRole('button', { name: /see an example draft/i });
    await user.click(openDraft());
    expect(screen.getByRole('heading', { name: BUSINESS_EXAMPLES[0].draftTitle })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /back to the example/i }));
    expect(openDraft()).toHaveFocus();
    await user.click(openDraft());
    await user.click(screen.getByRole('tab', { name: 'Catering' }));
    const panel = screen.getByRole('tabpanel', { name: 'Catering' });
    expect(within(panel).getByText(BUSINESS_EXAMPLES[2].request)).toBeInTheDocument();
    expect(screen.queryByText(BUSINESS_EXAMPLES[0].draft)).not.toBeInTheDocument();
    expect(openDraft()).toBeInTheDocument();
  });

  it('supports arrow keys, Home, and End for business tabs', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('tab', { name: 'Kopitiam' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Klinik' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Klinik' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Kedai' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Kopitiam' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Kedai' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Kopitiam' })).toHaveAttribute('aria-selected', 'true');
    for (const tab of screen.getAllByRole('tab')) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBe(
        screen.getByRole('tabpanel'),
      );
    }
  });

  it('closes mobile navigation on Escape and returns focus to its toggle', async () => {
    const user = userEvent.setup();
    mount();
    const menu = screen.getByRole('button', { name: 'Menu' });
    await user.click(menu);
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    within(nav).getByRole('link', { name: 'Sign in' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).not.toBeInTheDocument();
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });
});
