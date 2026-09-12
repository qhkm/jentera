import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { TaskProgress } from '@/components/TaskProgress';
import { RepositoryProvider, LocalRepository } from '@/lib/repo';

beforeEach(() => { localStorage.clear(); localStorage.setItem('aisar-lang', 'en'); });
async function mount(steps: string[], live = true) {
  const view = render(<RepositoryProvider repository={new LocalRepository()}><I18nProvider><TaskProgress steps={steps} live={live} /></I18nProvider></RepositoryProvider>);
  await waitFor(() => expect(view.container.querySelector('.task-progress')).not.toBeNull());
  return view;
}

describe('shared task progress', () => {
  it('groups repeated process updates without showing commands or login values, even expanded', async () => {
    const { container } = await mount([
      '💻 process: "submit proc_123 secret-login-value"',
      '💻 process: "poll proc_123"',
      '💻 process: "poll proc_123"',
    ]);
    expect(container.querySelectorAll('.task-progress-activities li')).toHaveLength(1);
    expect(screen.getByText('Waiting for a running process')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Show technical details'));
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(container.textContent).not.toMatch(/secret-login-value|proc_123|submit/);
    expect(container.querySelectorAll('.task-progress-technical li')).toHaveLength(3);
    expect(container.querySelectorAll('svg')).toHaveLength(0); // No fabricated success checkmarks.
  });

  it('uses evidence-based labels across different activities and limits visible history', async () => {
    const { container } = await mount(['web_search: "query"', 'web_extract: "url"', 'vision_analyze: "image"', 'Shortening conversation context before continuing…']);
    expect(container.querySelectorAll('.task-progress-activities li')).toHaveLength(3);
    expect(screen.getByText('Reading information')).toBeVisible();
    expect(screen.getByText('Checking an image')).toBeVisible();
    expect(screen.getByText('Preparing conversation context')).toBeVisible();
  });

  it('does not invent an installation milestone or login button from a command', async () => {
    await mount(['terminal: "npm install example-tool"']);
    expect(screen.getByText('Working through the task')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/installed|signed in/i)).toBeNull();
  });

  it('localises the card and stops the live indicator for a receipt', async () => {
    localStorage.setItem('aisar-lang', 'bm');
    const { container } = await mount(['web_search: "query"'], false);
    expect(screen.getByText('Mencari maklumat')).toBeVisible();
    expect(screen.getByText('Lihat butiran teknikal')).toBeVisible();
    expect(container.querySelector('[aria-current]')).toBeNull();
  });
});
