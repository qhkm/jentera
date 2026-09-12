import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ArtifactPreview } from '@/components/ArtifactPreview';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Artifact, Repository } from '@/lib/repo';

const RUN = '11111111-1111-4111-8111-111111111111';
const file = (over: Partial<Artifact> = {}): Artifact => ({
  id: 'a1', runId: RUN, name: 'tech-digest.md', contentType: 'text/markdown', size: 40, createdAt: '2026-09-12T01:00:00.000Z', ...over,
});

function mount(artifact: Artifact, blob: Blob | Error, onClose = vi.fn()) {
  const repo: Repository = new LocalRepository();
  repo.artifactUrl = (id) => `https://api.test/api/artifacts/${id}`;
  repo.fetchArtifact = vi.fn(async () => { if (blob instanceof Error) throw blob; return blob; });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repo}><I18nProvider>{children}</I18nProvider></RepositoryProvider>
  );
  render(<ArtifactPreview artifact={artifact} onClose={onClose} />, { wrapper });
  return { repo, onClose };
}

beforeEach(() => {
  localStorage.setItem('aisar-lang', 'en');
  URL.createObjectURL = vi.fn(() => 'blob:preview-1');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('ArtifactPreview', () => {
  it('renders a markdown file as the reply would, with the name, size and a download', async () => {
    mount(file(), new Blob(['# Tech Digest\n\n- OpenAI signs Firmus deal'], { type: 'text/markdown' }));
    const dialog = await screen.findByRole('dialog', { name: 'tech-digest.md' });
    expect(await within(dialog).findByRole('heading', { name: 'Tech Digest' })).toBeInTheDocument();
    expect(within(dialog).getByText(/OpenAI signs Firmus deal/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent('40 B');
    const download = within(dialog).getByRole('link', { name: /Download/ });
    expect(download).toHaveAttribute('href', 'https://api.test/api/artifacts/a1');
    expect(download).toHaveAttribute('download', 'tech-digest.md');
  });

  it('lays a CSV out as a table', async () => {
    mount(file({ id: 'a2', name: 'sales.csv', contentType: 'text/csv' }), new Blob(['product,qty\n"Nasi lemak, large",12\nTeh tarik,30\n']));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['product', 'qty']);
    expect(within(table).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Nasi lemak, large', '12', 'Teh tarik', '30']);
  });

  it('arrives as a sheet with a grab handle and, where motion is reduced or unavailable, leaves at once', async () => {
    const { onClose } = mount(file(), new Blob(['# Digest']));
    const dialog = await screen.findByRole('dialog', { name: 'tech-digest.md' });
    expect(dialog).toHaveClass('file-preview-dialog');
    expect(dialog.parentElement).toHaveClass('file-preview-backdrop');
    expect(dialog.firstElementChild).toHaveClass('file-preview-handle');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows an image from the fetched bytes and lets it go on close', async () => {
    const { onClose } = mount(file({ id: 'a3', name: 'chart.png', contentType: 'image/png' }), new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    const image = await screen.findByRole('img', { name: 'chart.png' });
    expect(image).toHaveAttribute('src', 'blob:preview-1');
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers only the download for a type it cannot show, and says why', async () => {
    mount(file({ id: 'a4', name: 'model.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), new Blob(['x']));
    const dialog = await screen.findByRole('dialog', { name: 'model.xlsx' });
    await waitFor(() => expect(dialog).toHaveTextContent(/No preview for this kind of file/));
    expect(within(dialog).getByRole('link', { name: /Download/ })).toBeInTheDocument();
  });

  it('says so when the file cannot be fetched', async () => {
    mount(file(), new Error('offline'));
    const dialog = await screen.findByRole('dialog', { name: 'tech-digest.md' });
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/could not be opened/i));
  });
});
