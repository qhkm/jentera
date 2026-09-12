import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import FilesView from '@/routes/views/FilesView';

const RUN = '11111111-1111-4111-8111-111111111111';

function mount(repo: LocalRepository, onOpenTask = vi.fn()) {
  render(
    <SignedInProvider value account="files-test">
      <RepositoryProvider repository={repo}>
        <I18nProvider><FilesView onOpenTask={onOpenTask} /></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
  return onOpenTask;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aisar-lang', 'en');
});

describe('FilesView', () => {
  it('lists every file Jentera produced, newest first, with a download and the task it came from', async () => {
    const repo = new LocalRepository();
    repo.artifactUrl = (id: string) => `https://api.test/api/artifacts/${id}`;
    repo.listArtifacts = vi.fn(async () => [
      { id: 'a2', runId: RUN, name: 'sources.csv', contentType: 'text/csv', size: 640, createdAt: '2026-09-12T02:00:00.000Z' },
      { id: 'a1', runId: RUN, name: 'tech-digest.md', contentType: 'text/markdown', size: 5321, createdAt: '2026-09-12T01:00:00.000Z' },
    ]);
    const user = userEvent.setup();
    const onOpenTask = mount(repo);
    const list = await screen.findByRole('list', { name: 'Files' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('sources.csv');
    expect(items[0]).toHaveTextContent('640 B');
    const download = within(items[1]).getByRole('link', { name: /Download/ });
    expect(download).toHaveAttribute('href', 'https://api.test/api/artifacts/a1');
    expect(download).toHaveAttribute('download', 'tech-digest.md');
    await user.click(within(items[1]).getByRole('button', { name: /Open task/ }));
    expect(onOpenTask).toHaveBeenCalledWith(RUN);
  });

  it('says so when there are no files yet, and when the list cannot load', async () => {
    const empty = new LocalRepository();
    empty.listArtifacts = vi.fn(async () => []);
    mount(empty);
    expect(await screen.findByText('No files yet')).toBeInTheDocument();

    const broken = new LocalRepository();
    broken.listArtifacts = vi.fn(async () => { throw new Error('offline'); });
    mount(broken);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i));
  });
});
