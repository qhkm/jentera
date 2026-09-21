import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import SkillsView from '../SkillsView';

function mount(repo = new LocalRepository()) {
  render(<RepositoryProvider repository={repo}><I18nProvider><SkillsView /></I18nProvider></RepositoryProvider>);
  return userEvent.setup();
}

describe('SkillsView', () => {
  it('shows the VM inventory by category and filters it without exposing instructions', async () => {
    const repo = new LocalRepository();
    repo.runtimeSkills = vi.fn(async () => [
      { id: 'web-research', name: 'Web research', description: 'Find and compare public sources.', category: 'Research', disabled: false },
      { id: 'pdf-reader', name: 'PDF reader', description: 'Read PDF documents.', category: 'Documents', disabled: false },
      { id: 'legacy-export', name: 'Legacy export', description: 'Export an older format.', category: 'Documents', disabled: true },
    ]);
    const user = mount(repo);

    expect(await screen.findByRole('heading', { name: 'Research' })).toBeVisible();
    const documents = screen.getByRole('heading', { name: 'Documents' }).closest('section')!;
    expect(within(documents).getAllByRole('article')).toHaveLength(2);
    expect(within(documents).getByText('Disabled')).toBeVisible();
    expect(screen.queryByText(/SKILL\.md|instruction/i)).toBeNull();

    await user.type(screen.getByRole('searchbox', { name: 'Search skills' }), 'web');
    expect(screen.getByRole('heading', { name: 'Web research' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'PDF reader' })).toBeNull();
  });

  it('distinguishes an empty VM from a failed inventory request', async () => {
    const empty = new LocalRepository();
    empty.runtimeSkills = vi.fn(async () => []);
    mount(empty);
    expect(await screen.findByText('No skills installed yet')).toBeVisible();

    const broken = new LocalRepository();
    broken.runtimeSkills = vi.fn(async () => { throw new Error('Computer is offline'); });
    mount(broken);
    expect(await screen.findByRole('alert')).toHaveTextContent('Computer is offline');
  });
});
