import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExternalTriggers from '@/components/ExternalTriggers';
import { SignedInProvider } from '@/lib/repo/gate';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';
import { TriggerError, type CreatedTrigger, type ExternalTrigger, type TriggerList } from '@/lib/external-triggers';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock('@/lib/external-triggers', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/external-triggers')>(),
  fetchTriggers: api.list, createTrigger: api.create, revokeTrigger: api.revoke,
  triggerEndpoint: (id: string) => 'https://api.jentera.test/api/webhooks/external/' + id,
}));
const ID = '33333333-3333-4333-8333-333333333333';
const secret = 'a'.repeat(64);
const row: ExternalTrigger = { id: ID, name: 'Trusted report service', task: 'business_summary', timeZone: 'Asia/Kuala_Lumpur',
  expiresAt: new Date(Date.now() + 86400_000).toISOString(), createdAt: new Date().toISOString(), revokedAt: null };
const list = (triggers: ExternalTrigger[] = [], available = true): TriggerList => ({ available, triggers, limits: { maxActive: 3, dailyEvents: 20, bodyBytes: 2048 } });
const created: CreatedTrigger = { trigger: row, secret, url: 'https://api.jentera.test/api/webhooks/external/' + ID };
const repo = () => new LocalRepository();
function tree(repository: LocalRepository, options: { signedIn?: boolean; version?: number; account?: string | null; business?: string | null } = {}) {
  return <SignedInProvider value={options.signedIn ?? true} account={options.account === undefined ? 'owner-one' : options.account}
    business={options.business === undefined ? 'business-one' : options.business} externalTriggersVersion={options.version ?? 1}>
    <RepositoryProvider repository={repository}><I18nProvider><ExternalTriggers /></I18nProvider></RepositoryProvider>
  </SignedInProvider>;
}
beforeEach(() => {
  localStorage.clear(); api.list.mockReset().mockResolvedValue(list()); api.create.mockReset().mockResolvedValue(created);
  api.revoke.mockReset().mockResolvedValue({ ...row, revokedAt: new Date().toISOString() });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add trigger' }));
  await user.type(screen.getByLabelText('Service or trigger name'), row.name);
  await user.click(screen.getByRole('button', { name: 'Review permission' }));
}
async function makeKey() {
  const user = userEvent.setup();
  render(tree(repo())); await review(user);
  await user.click(screen.getByRole('button', { name: 'Create signing key' }));
  await screen.findByLabelText('Service signing key'); return user;
}
describe('owner trigger controls', () => {
  it.each([{ signedIn: false }, { version: 2 }, { account: null }, { business: null }])('does not fetch or render for an undiscovered session: %j', async options => {
    render(tree(repo(), options));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'External triggers' })).toBeNull();
    expect(api.list).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
  });
  it('loads permissions without creating any key and requires a review before granting', async () => {
    const user = userEvent.setup(); render(tree(repo()));
    await review(user);
    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('may request only “Business summary”');
    expect(screen.getByRole('dialog')).toHaveTextContent('UTC+8');
    expect(screen.getByRole('dialog')).toHaveTextContent('not returned to the service');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Create signing key' }));
    await screen.findByLabelText('Service signing key');
    expect(api.create).toHaveBeenCalledTimes(1);
    const config = api.create.mock.calls[0][0];
    expect(config).toMatchObject({ name: row.name, task: row.task, timeZone: 'Asia/Kuala_Lumpur' });
    expect(config.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(config.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86400_000);
  });
  it('masks the key, copies only on request, explains the clipboard and clears the key on close', async () => {
    const user = await makeKey();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const field = screen.getByLabelText('Service signing key');
    expect(field).toHaveAttribute('type', 'password'); expect(field).toHaveValue(secret);
    expect(copy).not.toHaveBeenCalled();
    expect(screen.getByText(/Shown once\. Closing or leaving/)).toHaveFocus();
    expect(screen.getByText(/may be synced or read by other apps/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show key' }));
    expect(field).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Copy signing key' }));
    expect(copy).toHaveBeenCalledWith(secret);
    await user.click(screen.getByRole('button', { name: 'Close and hide key' }));
    expect(screen.queryByLabelText('Service signing key')).toBeNull();
    expect(document.body.innerHTML).not.toContain(secret);
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
    await user.click(screen.getByRole('button', { name: 'Refresh triggers' }));
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('clears the one-time key on pagehide, even if the page returns from the back/forward cache', async () => {
    await makeKey();
    fireEvent(window, new Event('pagehide'));
    expect(screen.queryByLabelText('Service signing key')).toBeNull();
    fireEvent(window, new Event('pageshow'));
    await screen.findByRole('button', { name: 'Add trigger' });
    expect(document.body.innerHTML).not.toContain(secret); expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('clears the key on Escape and never provides a reveal-again action in the list', async () => {
    await makeKey();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByLabelText('Service signing key')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show key' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeEnabled();
  });
  it('keeps revocation available while the pilot is paused and restores focus when cancelled', async () => {
    api.list.mockResolvedValue(list([row], false));
    const user = userEvent.setup(); render(tree(repo()));
    expect(await screen.findByRole('button', { name: 'Add trigger' })).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Revoke access' });
    await user.click(button);
    expect(api.revoke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Confirm revocation' }));
    expect(await screen.findByText('Access revoked.')).toBeVisible();
    expect(api.revoke).toHaveBeenCalledWith(ID, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Revoke access' })).toBeNull();
  });
  it('allows an expired grant to be revoked but does not count it as active', async () => {
    api.list.mockResolvedValue(list([{ ...row, expiresAt: '2020-01-01T00:00:00.000Z' }]));
    render(tree(repo()));
    await screen.findByText('Expired');
    expect(screen.getByText(/0 of 3 active/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeEnabled();
  });
  it('prevents adding a fourth active trigger', async () => {
    api.list.mockResolvedValue(list([row, { ...row, id: '44444444-4444-4444-8444-444444444444' }, { ...row, id: '55555555-5555-4555-8555-555555555555' }]));
    render(tree(repo()));
    expect(await screen.findByRole('button', { name: 'Add trigger' })).toBeDisabled();
    expect(screen.getByText(/3 of 3 active/)).toBeVisible();
  });
  it('never retries a lost create response, even when a refreshed list is initially empty', async () => {
    api.create.mockRejectedValue(new Error('Raw provider error ' + secret));
    const user = userEvent.setup(); render(tree(repo())); await review(user);
    await user.click(screen.getByRole('button', { name: 'Create signing key' }));
    expect(await screen.findByText(/may have been created/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh triggers' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh triggers' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeDisabled();
    expect(api.create).toHaveBeenCalledTimes(1); expect(document.body.innerHTML).not.toContain(secret);
    const id = api.create.mock.calls[0][0].id;
    api.list.mockResolvedValue(list([{ ...row, id }]));
    api.revoke.mockResolvedValue({ ...row, id, revokedAt: new Date().toISOString() });
    await user.click(screen.getByRole('button', { name: 'Refresh triggers' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revocation' }));
    await screen.findByText('Access revoked.');
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeEnabled();
  });
  it('blocks repeated submissions while a key is being created', async () => {
    let finish!: (value: CreatedTrigger) => void;
    api.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup(); render(tree(repo())); await review(user);
    await user.click(screen.getByRole('button', { name: 'Create signing key' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await act(async () => finish(created));
    await screen.findByLabelText('Service signing key'); expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('ignores an old account’s late create response after switching accounts', async () => {
    let finish!: (value: CreatedTrigger) => void;
    api.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup(); const repository = repo(); const mounted = render(tree(repository)); await review(user);
    await user.click(screen.getByRole('button', { name: 'Create signing key' }));
    const signal = api.create.mock.calls[0][1] as AbortSignal;
    mounted.rerender(tree(repository, { account: 'owner-two' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(created));
    await screen.findByRole('button', { name: 'Add trigger' });
    expect(screen.queryByLabelText('Service signing key')).toBeNull(); expect(document.body.innerHTML).not.toContain(secret);
  });
  it('bounds a stalled create and never retries even if the transport ignores cancellation', async () => {
    api.create.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup(); render(tree(repo())); await review(user);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Create signing key' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(api.create.mock.calls[0][1].aborted).toBe(true);
    expect(screen.getByText(/may have been created/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeDisabled();
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('does not display a key from a request completed after pagehide', async () => {
    let finish!: (value: CreatedTrigger) => void;
    api.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup(); render(tree(repo())); await review(user);
    await user.click(screen.getByRole('button', { name: 'Create signing key' }));
    fireEvent(window, new Event('pagehide'));
    fireEvent(window, new Event('pageshow'));
    await act(async () => finish(created));
    await screen.findByRole('button', { name: 'Add trigger' });
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeDisabled();
    expect(screen.queryByLabelText('Service signing key')).toBeNull();
    expect(document.body.innerHTML).not.toContain(secret);
  });
  it('does not retain the key after sign-out', async () => {
    const user = userEvent.setup(); const repository = repo(); const mounted = render(tree(repository)); await review(user);
    await user.click(screen.getByRole('button', { name: 'Create signing key' }));
    await screen.findByLabelText('Service signing key');
    mounted.rerender(tree(repository, { signedIn: false }));
    expect(document.body.innerHTML).not.toContain(secret);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('shows a translated error without granting when owner access changes', async () => {
    api.list.mockRejectedValue(new TriggerError('OWNER_REQUIRED'));
    render(tree(repo()));
    expect(await screen.findByRole('alert')).toHaveTextContent('owner permission or session changed');
    expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
  });
  it('translates setup, review and revocation controls into BM', async () => {
    const repository = repo(); await repository.setLang('bm');
    const user = userEvent.setup(); render(tree(repository));
    await user.click(await screen.findByRole('button', { name: 'Tambah pencetus' }));
    await user.type(screen.getByLabelText('Nama perkhidmatan atau pencetus'), row.name);
    await user.selectOptions(screen.getByLabelText('Laporan dibenarkan'), 'approval_reminder');
    await user.click(screen.getByRole('button', { name: 'Semak kebenaran' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Ringkasan kelulusan menunggu');
    expect(screen.getByRole('button', { name: 'Cipta kunci tandatangan' })).toBeEnabled();
    expect(api.create).not.toHaveBeenCalled();
  });
});
