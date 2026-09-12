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

function mount(over: Partial<Pick<Repository, 'ingestFile'>> = {}) {
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
