import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentMemoryPanel from '@/routes/views/AgentMemoryPanel';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { AgentMemory, Repository } from '@/lib/repo';

const MEMORY: AgentMemory = {
  available: true,
  profiles: [
    { profile: 'default', files: [
      { file: 'MEMORY.md', entries: [{ index: 0, text: 'pdftotext is absent on this machine.' }] },
      { file: 'USER.md', entries: [{ index: 0, text: 'qhkm prefers English replies.' }, { index: 1, text: 'favourite colour: teal' }] },
    ] },
    { profile: 'growth', files: [{ file: 'MEMORY.md', entries: [{ index: 0, text: 'Cron delivery has no platform here.' }] }, { file: 'USER.md', entries: [] }] },
  ],
};

function mount(memory: AgentMemory, over: Partial<Pick<Repository, 'forgetAgentMemory'>> = {}) {
  const repo = Object.assign(new LocalRepository(), { agentMemory: vi.fn(async () => memory) }, over) as Repository;
  render(
    <SignedInProvider value account="owner">
      <RepositoryProvider repository={repo}>
        <I18nProvider><ToastProvider><AgentMemoryPanel /></ToastProvider></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
  return repo;
}

beforeEach(() => localStorage.setItem('aisar-lang', 'en'));

describe('what Jentera has picked up', () => {
  it('lists each specialist\'s notes and what it knows about people, and counts them', async () => {
    mount(MEMORY);
    const people = await screen.findByRole('list', { name: 'Chief of Staff · About the people it talks to' });
    expect(within(people).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('qhkm prefers English replies.'), expect.stringContaining('favourite colour: teal'),
    ]);
    expect(screen.getByRole('region', { name: 'Growth and marketing' })).toHaveTextContent('Cron delivery has no platform here.');
    expect(screen.getByText('4 notes')).toBeInTheDocument();
  });

  it('forgets an entry after a confirm step and drops it from the list', async () => {
    const forgetAgentMemory = vi.fn(async () => {});
    mount(MEMORY, { forgetAgentMemory });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Forget: favourite colour: teal' }));
    expect(forgetAgentMemory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm forgetting: favourite colour: teal' }));
    expect(forgetAgentMemory).toHaveBeenCalledWith({ profile: 'default', file: 'USER.md', text: 'favourite colour: teal' });
    await waitFor(() => expect(screen.queryByText('favourite colour: teal')).toBeNull());
    expect(screen.getByText('3 notes')).toBeInTheDocument();
  });

  it('says so when the runtime cannot answer yet', async () => {
    mount({ available: false, profiles: [] });
    expect(await screen.findByText(/Not available yet/)).toBeInTheDocument();
  });
});
