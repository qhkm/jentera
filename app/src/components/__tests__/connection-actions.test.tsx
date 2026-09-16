import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Connection, ConnectionHealth } from '@/lib/repo';
import { I18nProvider } from '@/i18n/I18nProvider';
import GoogleCalendarConnect from '@/routes/views/GoogleCalendarConnect';
import TelegramConnect from '@/routes/views/TelegramConnect';
import TokenConnect from '@/routes/views/TokenConnect';

const connection: Connection = {
  id: 'account-1', connector: 'telegram', method: 'bss', status: 'connected', paired: true,
  displayName: 'Fictional owner bot', externalId: null, connectedAt: '', lastOkAt: null, lastError: null,
};
function mount(repo: LocalRepository, connector = 'telegram') {
  function Harness() {
    const [rows, setRows] = useState<Connection[] | null>([{ ...connection, connector }]);
    return connector === 'google' ? <GoogleCalendarConnect rows={rows} setRows={setRows} />
      : connector === 'google-sheets' ? <TokenConnect connector={connector} rows={rows} setRows={setRows} />
        : <TelegramConnect rows={rows} setRows={setRows} />;
  }
  render(<MemoryRouter><RepositoryProvider repository={repo}><I18nProvider><Harness /></I18nProvider></RepositoryProvider></MemoryRouter>);
  return userEvent.setup();
}

describe('connection account controls', () => {
  it('centres the expanded confirmation away from fixed phone navigation and restores focus on cancel', async () => {
    const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    try {
      const user = mount(new LocalRepository(), 'google');
      await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
      expect(scroll).toHaveBeenLastCalledWith({ block: 'center', behavior: 'instant' });
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'instant' });
      expect(screen.getByRole('button', { name: 'Disconnect' })).toHaveFocus();
    } finally {
      if (previous) Object.defineProperty(Element.prototype, 'scrollIntoView', previous);
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });
  it('checks Telegram only on request and disables repeated checks while waiting', async () => {
    const repo = new LocalRepository();
    let resolve!: (value: ConnectionHealth) => void;
    const check = vi.spyOn(repo, 'connectionHealth').mockImplementation(() => new Promise(done => { resolve = done; }));
    const user = mount(repo);
    const button = await screen.findByRole('button', { name: 'Check connection' });
    expect(check).not.toHaveBeenCalled();
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    resolve({ url: '', pending: 0, lastError: null, lastErrorAt: null, pointsHere: true });
    await screen.findByText(/Receiving normally/);
    expect(check).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
  });

  it.each(['telegram', 'google'])('requires confirmation and restores keyboard focus on cancel for %s', async connector => {
    const repo = new LocalRepository();
    const drop = vi.spyOn(repo, 'disconnect').mockResolvedValue(undefined);
    const user = mount(repo, connector);
    const trigger = await screen.findByRole('button', { name: 'Disconnect' });
    await user.click(trigger);
    expect(drop).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('group', { name: /Disconnect/ })).toHaveAttribute('aria-describedby');
    await user.keyboard('{Escape}');
    expect(trigger.isConnected).toBe(false);
    expect(screen.getByRole('button', { name: 'Disconnect' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
    await waitFor(() => expect(drop).toHaveBeenCalledWith('account-1'));
    expect(screen.queryByText('Fictional owner bot')).toBeNull();
  });

  it('preserves the connection when disconnect fails, and allows cancellation', async () => {
    const repo = new LocalRepository();
    vi.spyOn(repo, 'disconnect').mockRejectedValue(new Error('Temporary connection error'));
    const user = mount(repo, 'google');
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText(/Existing events stay/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary connection error');
    expect(screen.getByText('Fictional owner bot')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  it('does not expose token fields for a planned Google app even if the server lists it', async () => {
    const repo = new LocalRepository();
    const catalogue = vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([{ connector: 'google-sheets', label: 'Google Sheets' }]);
    mount(repo, 'google-sheets');
    await waitFor(() => expect(catalogue).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByLabelText('Token')).toBeNull();
  });
});
