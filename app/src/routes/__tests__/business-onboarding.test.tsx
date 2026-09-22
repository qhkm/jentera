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
import { workflowBriefKey, workflowCategoryKey, workflowTaskKey } from '@/lib/first-workflow';

function mount(repo: LocalRepository, firstJob?: boolean) {
  return render(<MemoryRouter><SignedInProvider value><RepositoryProvider repository={repo}><I18nProvider><ToastProvider>
    {firstJob === undefined ? <BusinessOnboarding /> : <FirstJob ready={firstJob} />}
  </ToastProvider></I18nProvider></RepositoryProvider></SignedInProvider></MemoryRouter>);
}
beforeEach(() => localStorage.clear());

async function chooseWorkflow(task = 'Prepare my weekly sales report') {
  await userEvent.click(await screen.findByRole('button', { name: /Reports/ }));
  await userEvent.type(screen.getByLabelText('What is one task you repeat every day or every week?'), task);
  await userEvent.click(screen.getByRole('button', { name: 'Use this as my first workflow' }));
}

describe('real business onboarding', () => {
  it('shows a dedicated reading state until ingestion finishes, then opens review', async () => {
    const repo = new LocalRepository();
    let finish!: (value: { facts: number; suggestions: { key: string; value: string; confidence: number }[] }) => void;
    repo.ingest = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(repo);
    await chooseWorkflow();
    await userEvent.click(screen.getByRole('button', { name: 'Website or public page' }));
    await userEvent.type(screen.getByPlaceholderText('yourbusiness.com'), 'example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByRole('heading', { name: 'Building your business picture' })).toHaveFocus();
    expect(screen.getByRole('status', { name: 'Reading your source…' })).toHaveTextContent('https://example.com');
    expect(screen.getByRole('status', { name: 'Reading your source…' })).toHaveTextContent('Reading');
    expect(screen.queryByRole('button', { name: 'Learn about my business' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('yourbusiness.com')).not.toBeInTheDocument();
    finish({ facts: 1, suggestions: [{ key: 'business.name', value: 'Example Business', confidence: 0.9 }] });
    expect(await screen.findByRole('heading', { name: 'Here’s what I understood.' })).toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'Building your business picture' })).not.toBeInTheDocument();
  });
  it('welcomes the signed-in owner before selecting the first workflow without running it', async () => {
    const repo = new LocalRepository();
    repo.ask = vi.fn();
    mount(repo);
    expect(await screen.findByRole('region', { name: 'Welcome to Jentera!' })).toHaveTextContent('first useful job');
    expect(await screen.findByRole('heading', { name: 'What would you like your AI Staff to help with first?' })).toBeVisible();
    expect(repo.ask).not.toHaveBeenCalled();
  });
  it('does not skip reading after an anonymous demo, and does not treat zero facts as success', async () => {
    localStorage.setItem(KEYS.onboardingDraft, JSON.stringify({ completedDemo: true, step: 5, url: 'example.com' }));
    const repo = new LocalRepository();
    repo.ingest = vi.fn().mockResolvedValue({ facts: 0, chars: 20, suggestions: [] });
    mount(repo);
    await chooseWorkflow();
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
    expect(screen.getByRole('region', { name: 'Your business is taking shape.' })).toHaveTextContent('Wrong name');
    await userEvent.clear(input); await userEvent.type(input, 'Correct Business');
    await userEvent.click(screen.getByRole('checkbox', { name: 'About your business' }));
    expect(screen.getByRole('region', { name: 'Your business is taking shape.' })).not.toHaveTextContent('Unwanted claim');
    expect(screen.getByRole('region', { name: 'Your business is taking shape.' })).toHaveTextContent('Correct Business');
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
    await chooseWorkflow();
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
    await chooseWorkflow();
    await userEvent.click(await screen.findByRole('button', { name: 'Describe your business' }));
    await userEvent.type(screen.getByLabelText('What do you offer, and who do you help?'), 'We teach workshops for small businesses.');
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByRole('textbox', { name: 'About your business' })).toHaveValue('We teach workshops for small businesses.');
    expect(repo.ingest).not.toHaveBeenCalled();
    expect((await repo.load()).onboarded).toBe(false);
  });
});

describe('workflow-first onboarding', () => {
  it('replaces each prompt and preserves answers when changing earlier choices', async () => {
    mount(new LocalRepository());
    await userEvent.click(await screen.findByRole('button', { name: /Reports/ }));
    expect(screen.queryByRole('heading', { name: 'What would you like your AI Staff to help with first?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'First workflow category' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is one task you repeat every day or every week?' })).toHaveFocus();
    await userEvent.type(screen.getByLabelText('What is one task you repeat every day or every week?'), 'Prepare weekly figures');
    await userEvent.click(screen.getByRole('button', { name: /Reports.*Change/ }));
    await userEvent.click(screen.getByRole('button', { name: /Reports/ }));
    expect(screen.getByLabelText('What is one task you repeat every day or every week?')).toHaveValue('Prepare weekly figures');
    await userEvent.click(screen.getByRole('button', { name: 'Use this as my first workflow' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Website or public page' }));
    expect(screen.queryByRole('button', { name: 'Upload a document' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('yourbusiness.com'), 'example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Change source' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Website or public page' }));
    expect(screen.getByPlaceholderText('yourbusiness.com')).toHaveValue('example.com');
  });
  it('starts with six outcome choices and does not save or execute an unconfirmed task', async () => {
    const repo = new LocalRepository(); repo.ask = vi.fn(); repo.setFact = vi.fn(); repo.provisionRuntime = vi.fn();
    mount(repo);
    expect(await screen.findByRole('heading', { name: 'What would you like your AI Staff to help with first?' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'First workflow category' }).querySelectorAll('button')).toHaveLength(6);
    await chooseWorkflow('Prepare my customer quotations');
    expect(screen.getByRole('heading', { name: 'Where can I learn about your business?' })).toHaveFocus();
    expect(repo.ask).not.toHaveBeenCalled(); expect(repo.setFact).not.toHaveBeenCalled(); expect(repo.provisionRuntime).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEYS.onboardingDraft)).not.toContain('Prepare my customer quotations');
  });
  it('requires a category and a nonblank task, while keeping other work describable', async () => {
    mount(new LocalRepository());
    expect(screen.queryByLabelText('What is one task you repeat every day or every week?')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Something else/ }));
    await userEvent.type(await screen.findByLabelText('What is one task you repeat every day or every week?'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Use this as my first workflow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Describe one repetitive task');
    await userEvent.clear(screen.getByLabelText('What is one task you repeat every day or every week?'));
    await userEvent.type(screen.getByLabelText('What is one task you repeat every day or every week?'), 'Prepare a packing checklist');
    await userEvent.click(screen.getByRole('button', { name: 'Use this as my first workflow' }));
    expect(screen.getByRole('heading', { name: 'Where can I learn about your business?' })).toBeVisible();
  });
  it('persists the chosen task only when the owner confirms the reviewed details', async () => {
    const repo = new LocalRepository(); repo.ask = vi.fn();
    mount(repo);
    await chooseWorkflow();
    await userEvent.click(screen.getByRole('button', { name: 'Describe your business' }));
    await userEvent.type(screen.getByLabelText('What do you offer, and who do you help?'), 'We sell coffee.');
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    expect(await screen.findByRole('textbox', { name: 'Your repetitive task' })).toHaveValue('Prepare my weekly sales report');
    expect((await repo.load()).facts.find(f => f.key === workflowTaskKey)).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm details & prepare Jentera' }));
    await waitFor(async () => expect((await repo.load()).onboarded).toBe(true));
    expect((await repo.load()).facts.find(f => f.key === workflowTaskKey)).toMatchObject({ confirmed: true, value: 'Prepare my weekly sales report' });
    expect((await repo.load()).facts.find(f => f.key === workflowCategoryKey)).toMatchObject({ confirmed: true, value: 'reports' });
    expect(repo.ask).not.toHaveBeenCalled();
  });
  it('does not save a repetitive task the owner unticks during review', async () => {
    const repo = new LocalRepository(); mount(repo);
    await chooseWorkflow();
    await userEvent.click(screen.getByRole('button', { name: 'Describe your business' }));
    await userEvent.type(screen.getByLabelText('What do you offer, and who do you help?'), 'We sell coffee.');
    await userEvent.click(screen.getByRole('button', { name: 'Learn about my business' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Your repetitive task' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm details & prepare Jentera' }));
    await waitFor(async () => expect((await repo.load()).onboarded).toBe(true));
    expect((await repo.load()).facts.find(f => f.key === workflowTaskKey)).toBeUndefined();
  });
});

describe('the first useful job', () => {
  it('carries the confirmed workflow into an editable brief without starting or scheduling it', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: workflowTaskKey, value: 'Prepare my weekly sales report', source: 'owner' });
    repo.ask = vi.fn().mockResolvedValue({ runId: '11111111-1111-4111-8111-111111111111', text: 'Workflow draft', usedKeys: [], grounded: true });
    mount(repo, true);
    expect((await screen.findByLabelText('Your brief') as HTMLTextAreaElement).value).toContain('Prepare my weekly sales report');
    expect(repo.ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Create this draft' }));
    await screen.findByRole('button', { name: 'View your work' });
    expect(repo.ask).toHaveBeenCalledWith(expect.stringContaining('Do not claim that this workflow is active or scheduled.'), expect.objectContaining({ mode: 'work', requestId: expect.any(String) }));
    expect(vi.mocked(repo.ask).mock.calls[0][0]).toContain('do not send, publish, schedule or contact anyone');
  });
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
  it('saves a brief while provisioning, restores it on return and requires a fresh start after readiness', async () => {
    const repo = new LocalRepository(); repo.ask = vi.fn().mockResolvedValue({ runId: '11111111-1111-4111-8111-111111111111', text: 'Draft', usedKeys: [], grounded: true });
    const view = mount(repo, false);
    await userEvent.click(await screen.findByRole('button', { name: /A week of content/ }));
    const brief = screen.getByLabelText('Your brief');
    await userEvent.clear(brief); await userEvent.type(brief, 'Prepare a coffee campaign');
    expect((await repo.load()).facts.find(f => f.key === workflowBriefKey)).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Save my first job' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save my first job' }));
    expect(await screen.findByRole('button', { name: 'First job saved' })).toBeDisabled();
    expect((await repo.load()).facts.find(f => f.key === workflowBriefKey)).toMatchObject({ value: 'Prepare a coffee campaign', confirmed: true });
    expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
    expect(repo.ask).not.toHaveBeenCalled();
    view.unmount();
    mount(repo, true);
    expect(await screen.findByLabelText('Your brief')).toHaveValue('Prepare a coffee campaign');
    expect(repo.ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Create this draft' }));
    await screen.findByRole('button', { name: 'View your work' });
    expect(repo.ask).toHaveBeenCalledOnce();
  });
  it('keeps an unsuccessful save editable and retryable without calling the agent', async () => {
    const repo = new LocalRepository(); repo.ask = vi.fn();
    const setFact = repo.setFact.bind(repo);
    repo.setFact = vi.fn().mockRejectedValueOnce(new Error('Could not save')).mockImplementation(setFact);
    mount(repo, false);
    await userEvent.click(await screen.findByRole('button', { name: /A week of content/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save my first job' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('button', { name: 'Save my first job' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save my first job' }));
    await screen.findByRole('button', { name: 'First job saved' });
    await userEvent.type(screen.getByLabelText('Your brief'), ' Include Instagram.');
    expect(screen.getByRole('button', { name: 'Save my first job' })).toBeEnabled();
    expect(repo.ask).not.toHaveBeenCalled();
  });
  it('does not start automatically when readiness changes', async () => {
    const repo = new LocalRepository(); repo.ask = vi.fn();
    const contents = (ready: boolean) => <MemoryRouter><SignedInProvider value><RepositoryProvider repository={repo}><I18nProvider><ToastProvider>
      <FirstJob ready={ready} />
    </ToastProvider></I18nProvider></RepositoryProvider></SignedInProvider></MemoryRouter>;
    const view = render(contents(false));
    await userEvent.click(await screen.findByRole('button', { name: /A practical checklist/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save my first job' }));
    await screen.findByRole('button', { name: 'First job saved' });
    view.rerender(contents(true));
    expect(screen.getByRole('button', { name: 'Create this draft' })).toBeEnabled();
    expect(repo.ask).not.toHaveBeenCalled();
  });
  it('uses confirmed knowledge for choices and submits only after the owner asks', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: 'business.about', value: 'We run workshops.', source: 'owner' });
    await repo.confirmFact('business.about');
    repo.ask = vi.fn().mockResolvedValue({ runId: '11111111-1111-4111-8111-111111111111', taskStatus: 'completed', text: 'Draft ready', usedKeys: [], grounded: true });
    mount(repo, true);
    await userEvent.click(await screen.findByRole('button', { name: /A workshop follow-up/ }));
    expect(repo.ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Create this draft' }));
    expect(await screen.findByRole('button', { name: 'View your work' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Your first draft is here.' })).toHaveTextContent('Draft ready');
    expect(repo.ask).toHaveBeenCalledWith(expect.stringContaining('Draft only: do not send'), expect.objectContaining({ mode: 'work', requestId: expect.any(String) }));
  });
});
