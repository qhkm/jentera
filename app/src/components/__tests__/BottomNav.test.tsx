import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomNav } from '@/components/BottomNav';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

const SIX = [
  { id: 'home', label: 'Home', icon: 'home' as const },
  { id: 'work', label: 'Activity', icon: 'activity' as const, badge: 2 },
  { id: 'notifications', label: 'Alerts', icon: 'notifications' as const },
  { id: 'files', label: 'Files', icon: 'files' as const },
  { id: 'routines', label: 'Routines', icon: 'routines' as const },
  { id: 'business', label: 'Business', icon: 'business' as const, badge: 1 },
];

function mount(current = 'home', items = SIX) {
  const onGo = vi.fn();
  render(
    <RepositoryProvider repository={new LocalRepository()}><I18nProvider>
      <BottomNav items={items} current={current} onGo={onGo} label="Dashboard" />
    </I18nProvider></RepositoryProvider>,
  );
  return onGo;
}

beforeEach(() => {
  localStorage.setItem('aisar-lang', 'en');
  /* jsdom has no dialog implementation. */
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

describe('the phone bottom bar', () => {
  it('shows three sections and More, with the rest behind it', async () => {
    const onGo = mount();
    const nav = await screen.findByRole('navigation', { name: 'Dashboard' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Activity2', 'Alerts', 'More1']);
    const user = userEvent.setup();
    await user.click(within(nav).getByRole('button', { name: /More/ }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(['Files', 'Routines', 'Business1']);
    await user.click(within(sheet).getByRole('button', { name: /Business/ }));
    expect(onGo).toHaveBeenCalledWith('business');
  });

  it('marks More as current when the open section lives behind it', async () => {
    mount('files');
    const nav = await screen.findByRole('navigation', { name: 'Dashboard' });
    expect(within(nav).getByRole('button', { name: /More/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('shows every section as its own button when four or fewer', async () => {
    mount('home', SIX.slice(0, 4));
    const nav = await screen.findByRole('navigation', { name: 'Dashboard' });
    expect(within(nav).getAllByRole('button')).toHaveLength(4);
    expect(within(nav).queryByRole('button', { name: /More/ })).toBeNull();
  });
});
