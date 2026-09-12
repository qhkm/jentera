import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import BusinessOnboarding from '@/routes/BusinessOnboarding';
import { FirstJob } from '@/components/FirstJob';
import { LocalRepository, RepositoryProvider } from '@/lib/repo';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { KEYS } from '@/lib/storage';

function mount(repo: LocalRepository, firstJob?: boolean) {
  return render(<MemoryRouter><SignedInProvider value><RepositoryProvider repository={repo}><I18nProvider><ToastProvider>
    {firstJob === undefined ? <BusinessOnboarding /> : <FirstJob ready={firstJob} />}
  </ToastProvider></I18nProvider></RepositoryProvider></SignedInProvider></MemoryRouter>);
}
beforeEach(() => localStorage.clear());

describe('real business onboarding', () => {
  it('does not skip reading after an anonymous demo, and does not treat zero facts as success', async () => {
    localStorage.setItem(KEYS.onboardingDraft, JSON.stringify({ completedDemo: true, step: 5, url: 'example.com' }));
    const repo = new LocalRepository();
    repo.ingest = vi.fn().mockResolvedValue({ facts: 0, chars: 20, suggestions: [] });
    mount(repo);
    expect(await screen.findByDisplayValue('example.com')).toBeInTheDocument();
    expect(repo.ingest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t find enough');
    expect(screen.queryByText('Here’s what I understood.')).not.toBeInTheDocument();
    expect((await repo.load()).onboarded).toBe(false);
  });
  it('shows source-labelled findings, saves corrections and confirms only selected facts', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: 'business.name', value: 'Wrong name', source: 'agent', sourceRef: 'https://example.com' });
    await repo.setFact({ key: 'business.about', value: 'Unwanted claim', source: 'agent', sourceRef: 'https://example.com' });
    mount(repo);
    const input = await screen.findByRole('textbox', { name: 'Business name' });
    expect(screen.getAllByRole('link', { name: 'https://example.com/' })).toHaveLength(2);
    await userEvent.clear(input); await userEvent.type(input, 'Correct Business');
    await userEvent.click(screen.getByRole('checkbox', { name: 'About your business' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm details & prepare Jentera' }));
    await waitFor(async () => expect((await repo.load()).onboarded).toBe(true));
    const snap = await repo.load();
    expect(snap.bizName).toBe('Correct Business');
    expect(snap.facts.find(f => f.key === 'business.about')?.confirmed).toBe(false);
    expect(snap.facts.find(f => f.key === 'business.name')?.confirmed).toBe(true);
  });
  it('uses the document ingestion route and offers retry on failure', async () => {
    const repo = Object.assign(new LocalRepository(), { ingestFile: vi.fn().mockRejectedValueOnce(new Error('Cannot read document')).mockResolvedValue({ facts: 1, suggestions: [{ key: 'business.about', value: 'We run workshops', confidence: 0.9 }] }) });
    mount(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a document' }));
    await userEvent.upload(screen.getByLabelText('Upload a document'), new File(['workshops'], 'business.txt', { type: 'text/plain' }));
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot read document');
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByText('Source: business.txt')).toBeInTheDocument();
  });
  it('keeps manual descriptions as reviewable owner input, not a pretend extraction', async () => {
    const repo = new LocalRepository(); repo.ingest = vi.fn();
    mount(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Describe your business' }));
    await userEvent.type(screen.getByLabelText('What do you offer, and who do you help?'), 'We teach workshops for small businesses.');
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByRole('textbox', { name: 'About your business' })).toHaveValue('We teach workshops for small businesses.');
    expect(repo.ingest).not.toHaveBeenCalled();
    expect((await repo.load()).onboarded).toBe(false);
  });
});

describe('the first useful job', () => {
  it('reuses the request identity when the owner retries an ambiguous network failure', async () => {
    const repo = new LocalRepository();
    repo.ask = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ runId: '11111111-1111-4111-8111-111111111111', text: 'Draft', usedKeys: [], grounded: true });
    mount(repo, true);
    await userEvent.click(await screen.findByRole('button', { name: /A week of content/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create this draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    await userEvent.click(screen.getByRole('button', { name: 'Create this draft' }));
    await screen.findByRole('button', { name: 'View your work' });
    const calls = vi.mocked(repo.ask).mock.calls;
    expect(calls[0][1]?.requestId).toBe(calls[1][1]?.requestId);
  });
  it('allows preparing a brief while provisioning but does not execute', async () => {
    const repo = new LocalRepository(); repo.ask = vi.fn(); mount(repo, false);
    await userEvent.click(await screen.findByRole('button', { name: /A week of content/ }));
    expect(screen.getByRole('button', { name: 'Create this draft' })).toBeDisabled();
    expect(repo.ask).not.toHaveBeenCalled();
  });
  it('uses confirmed knowledge for choices and submits only after the owner asks', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: 'business.about', value: 'We run workshops.', source: 'owner' });
    await repo.confirmFact('business.about');
    repo.ask = vi.fn().mockResolvedValue({ runId: '11111111-1111-4111-8111-111111111111', text: 'Draft ready', usedKeys: [], grounded: true });
    mount(repo, true);
    await userEvent.click(await screen.findByRole('button', { name: /A workshop follow-up/ }));
    expect(repo.ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Create this draft' }));
    expect(await screen.findByRole('button', { name: 'View your work' })).toBeInTheDocument();
    expect(repo.ask).toHaveBeenCalledWith(expect.stringContaining('Draft only: do not send'), expect.objectContaining({ mode: 'work', requestId: expect.any(String) }));
  });
});
