import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgePanel, { describeRead } from '@/routes/views/KnowledgePanel';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { Repository } from '@/lib/repo';

function mount(over: Partial<Repository> = {}) {
  localStorage.setItem('aisar-biz-type', 'restaurant');
  const repo = Object.assign(new LocalRepository(), over) as Repository;
  render(
    <SignedInProvider value account="owner">
      <RepositoryProvider repository={repo}>
        <I18nProvider><ToastProvider><KnowledgePanel /></ToastProvider></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
  return repo;
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('aisar-lang', 'en'); });

describe('learning from a document', () => {
  it('staff can read facts without import, edit, confirm, or memory controls', async () => {
    const local = new LocalRepository();
    await local.setFact({ key: 'service.price', value: 'RM 100', source: 'owner' });
    const load = async () => ({ ...await local.load(), canManageKnowledge: false });
    const agentMemory = vi.fn();
    mount({ load, agentMemory });
    expect(await screen.findByText('RM 100')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Read it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(agentMemory).not.toHaveBeenCalled();
  });

  it('shows the current value and discards a replacement without losing it', async () => {
    const local = new LocalRepository();
    await local.setFact({ key: 'service.price', value: 'RM 100', source: 'owner' });
    await local.setFact({ key: 'service.price', value: 'RM 80', source: 'agent', sourceRef: 'old-menu.pdf' });
    mount();
    expect(await screen.findByText(/Current confirmed value: RM 100/)).toBeInTheDocument();
    expect(screen.getByText('Source: old-menu.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard suggestion' }));
    expect(await screen.findByText('RM 100')).toBeInTheDocument();
    expect(screen.queryByText('RM 80')).toBeNull();
  });
  it('offers an upload only where the repository can read one', async () => {
    mount();
    await screen.findByText(/Let Jentera read your website/);
    expect(screen.queryByLabelText('Upload a document')).toBeNull();
  });

  it('hands the chosen file to the repository and says what was found', async () => {
    const ingestFile = vi.fn(async () => ({ runId: 'r1', facts: 2, keys: ['hours', 'phone'], chars: 900, suggestions: [], source: 'opening-hours.txt' }));
    mount({ ingestFile });
    const input = await screen.findByLabelText('Upload a document');
    const file = new File(['We open 9 to 6.'], 'opening-hours.txt', { type: 'text/plain' });
    await userEvent.upload(input, file);
    expect(ingestFile).toHaveBeenCalledWith(file);
    expect(await screen.findByText(/Jentera found 2 things in opening-hours\.txt/)).toBeInTheDocument();
  });

  it('words a document read without the JavaScript warning a short page gets', () => {
    expect(describeRead({ facts: 0, chars: 12 }, 'menu.pdf')).toMatch(/read menu\.pdf but found nothing/);
    expect(describeRead({ facts: 0, chars: 12 })).toMatch(/needs JavaScript/);
  });
});
