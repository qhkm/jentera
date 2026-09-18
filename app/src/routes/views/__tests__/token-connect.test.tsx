/* A provider that needs a second value beside the token — Bukku sends the
   company subdomain as a header on every request — and one that does not. */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Connection } from '@/lib/repo';
import { I18nProvider } from '@/i18n/I18nProvider';
import TokenConnect from '@/routes/views/TokenConnect';

const BUKKU = {
  connector: 'Bukku',
  label: 'Bukku',
  account: { label: 'Company subdomain', hint: 'The name in your Bukku address — for aisar.bukku.my, that is “aisar”.' },
};
const PLAIN = { connector: 'Cloudflare', label: 'Cloudflare' };

const saved: Connection = {
  id: 'c1', connector: 'Bukku', method: 'api_token', status: 'connected', paired: false,
  displayName: 'Aisar AI', externalId: 'aisar', connectedAt: '', lastOkAt: null, lastError: null,
};

function mount(repo: LocalRepository) {
  function Harness() {
    const [rows, setRows] = useState<Connection[] | null>([]);
    return <TokenConnect rows={rows} setRows={setRows} />;
  }
  render(<MemoryRouter><RepositoryProvider repository={repo}><I18nProvider><Harness /></I18nProvider></RepositoryProvider></MemoryRouter>);
  return userEvent.setup();
}

describe('connecting a service with a token', () => {
  /* Every connector's Connect button points at this one card. Without the
     fragment it offered whichever service sorted first, so asking for Bukku
     landed on a form for Cloudflare. */
  it('offers the service the owner actually clicked', async () => {
    window.location.hash = '#connection-tokens-bukku';
    const repo = new LocalRepository();
    vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([PLAIN, BUKKU]);
    mount(repo);
    const select = await screen.findByRole('combobox');
    expect(select).toHaveValue('Bukku');
    /* And the field only Bukku needs came with it. */
    expect(screen.getByLabelText('Company subdomain')).toBeInTheDocument();
    window.location.hash = '';
  });

  it('falls back to the first service when reached on its own', async () => {
    window.location.hash = '';
    const repo = new LocalRepository();
    vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([PLAIN, BUKKU]);
    mount(repo);
    expect(await screen.findByRole('combobox')).toHaveValue('Cloudflare');
  });

  it('asks for the company as well, and sends both', async () => {
    const repo = new LocalRepository();
    vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([BUKKU]);
    const connect = vi.spyOn(repo, 'connectToken').mockResolvedValue(saved);
    const user = mount(repo);

    const account = await screen.findByLabelText('Company subdomain');
    /* The provider declares the field, so the form renders one it has
       never heard of without a release of its own. */
    expect(screen.getByText(/aisar\.bukku\.my/)).toBeInTheDocument();

    const token = screen.getByLabelText(/token/i);
    await user.type(token, 'jwt.token.value');
    /* A token alone is not enough for this provider: sending it without
       the company gets a 403 the owner cannot act on. */
    expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled();

    await user.type(account, 'aisar');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    expect(connect).toHaveBeenCalledWith('Bukku', 'jwt.token.value', 'aisar');
  });

  it('asks for nothing extra when the provider needs nothing extra', async () => {
    const repo = new LocalRepository();
    vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([PLAIN]);
    const connect = vi.spyOn(repo, 'connectToken').mockResolvedValue({ ...saved, connector: 'Cloudflare' });
    const user = mount(repo);

    await screen.findByLabelText(/token/i);
    expect(screen.queryByLabelText('Company subdomain')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/token/i), 'a-cloudflare-token');
    expect(screen.getByRole('button', { name: /connect/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /connect/i }));
    expect(connect).toHaveBeenCalledWith('Cloudflare', 'a-cloudflare-token', undefined);
  });

  it('clears both fields once saved, so neither survives in the form', async () => {
    const repo = new LocalRepository();
    vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([BUKKU]);
    vi.spyOn(repo, 'connectToken').mockResolvedValue(saved);
    const user = mount(repo);
    await user.type(await screen.findByLabelText(/token/i), 'jwt.token.value');
    await user.type(screen.getByLabelText('Company subdomain'), 'aisar');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    expect(await screen.findByLabelText(/token/i)).toHaveValue('');
    expect(screen.getByLabelText('Company subdomain')).toHaveValue('');
  });
});
