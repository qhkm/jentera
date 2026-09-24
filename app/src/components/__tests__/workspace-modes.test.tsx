import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import { ConversationList } from '@/components/ChatWorkspace';
import { WorkspaceModeSwitch } from '@/components/WorkspaceModeSwitch';
import { ToastProvider } from '@/components/Toast';
import Dashboard from '@/routes/Dashboard';
import { ActivityProvider } from '@/hooks/useActivity';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskSession } from '@/hooks/useAsk';
import type { AskAnswer } from '@/lib/repo';
import type { RoutinesApi } from '@/lib/routines/types';
import { listFixture } from '@/lib/routines/__tests__/fixtures';
import { bookingFixture, BOOKING_ID, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

async function mount(children: ReactNode, repo = new LocalRepository(), entry = '/app',
  options: { signedIn?: boolean; routinesVersion?: number; appsVersion?: number } = {}) {
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = async () => ({ counters: { handled: 0, needsYou: 2, minutesSaved: 0, thisWeek: 0, connections: 0 }, work: [] });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SignedInProvider value={options.signedIn ?? true} account="workspace-modes-test" routinesVersion={options.routinesVersion} appsVersion={options.appsVersion}>
        <RepositoryProvider repository={repo}>
          <I18nProvider>
            <ToastProvider>
              <ActivityProvider>{children}</ActivityProvider>
            </ToastProvider>
          </I18nProvider>
        </RepositoryProvider>
      </SignedInProvider>
    </MemoryRouter>,
  );
}
async function sidebarQueries() {
  await waitFor(() => expect(document.querySelector('.dashboard-sidebar')).not.toBeNull());
  return within(document.querySelector('.dashboard-sidebar') as HTMLElement);
}

const sessions: AskSession[] = [
  { id: 'older', title: 'Supplier notes', createdAt: 100, updatedAt: 100, messages: [{ from: 'ai', text: 'Kopi beans arrive Monday.' }] },
  { id: 'newer', title: 'Catering quotation', createdAt: 200, updatedAt: 200, messages: [{ from: 'you', text: 'Prepare a quote.' }, { from: 'ai', text: '', pendingId: 'pending' }] },
];

describe('workspace navigation', () => {
  it('resets only desktop content scroll and preserves the sidebar when changing sections', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(min-width: 1024px)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    await mount(<Dashboard />);
    const sidebar = await sidebarQueries();
    const content = document.querySelector('.dashboard-content') as HTMLElement;
    const navigation = document.querySelector('.dashboard-sidebar') as HTMLElement;
    content.scrollTop = 180;
    navigation.scrollTop = 90;
    await userEvent.click(sidebar.getByRole('button', { name: 'Notifications' }));
    expect(content.scrollTop).toBe(0);
    expect(navigation.scrollTop).toBe(90);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('keeps mobile section navigation resetting the page scroll', async () => {
    await mount(<Dashboard />);
    await sidebarQueries();
    const navigation = within(document.querySelector('.dashboard-bottom-nav') as HTMLElement);
    await userEvent.click(navigation.getByRole('button', { name: /^Activity/ }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });
  it('keeps the business identity as one keyboard-operable row without sidebar setup progress', async () => {
    function Location() { return <output data-testid="location">{useLocation().search}</output>; }
    await mount(<><Dashboard /><Location /></>);
    const sidebar = await sidebarQueries();
    const profile = sidebar.getByRole('button', { name: 'Open your business profile' });
    expect(within(profile).getByText('Kedai Kita')).toBeInTheDocument();
    expect(within(profile).getByText('Shah Alam')).toBeInTheDocument();
    expect(sidebar.queryByRole('progressbar')).toBeNull();
    expect(sidebar.queryByText('Setup progress')).toBeNull();
    profile.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('view=business&tab=profile');
  });
  it('groups every existing desktop destination once under Overview, Work and Workspace', async () => {
    await mount(<Dashboard />);
    const sidebar = await sidebarQueries();
    const nav = sidebar.getByRole('navigation', { name: 'Dashboard' });
    const overview = within(nav).getByRole('group', { name: 'Overview' });
    const work = within(nav).getByRole('group', { name: 'Work' });
    const workspace = within(nav).getByRole('group', { name: 'Workspace' });
    expect(within(overview).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(within(overview).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    await waitFor(() => expect(within(work).getByRole('button', { name: /^Activity/ })).toHaveTextContent('2'));
    expect(within(work).getAllByRole('button')).toHaveLength(1);
    for (const name of ['Skills', 'Library', 'Files', 'My Business']) expect(within(workspace).getByRole('button', { name })).toBeInTheDocument();
    expect(within(nav).getAllByRole('button')).toHaveLength(7);
    const mobile = document.querySelector('.dashboard-bottom-nav')!;
    expect([...mobile.querySelectorAll(':scope > button')].slice(0, 4).map(button => button.textContent))
      .toEqual(['Home', 'Activity2', 'Chat', 'Skills']);
  });
  it('keeps grouped destinations keyboard-operable and on their existing URLs', async () => {
    function Location() { return <output data-testid="location">{useLocation().search}</output>; }
    await mount(<><Dashboard /><Location /></>);
    const sidebar = await sidebarQueries();
    const library = sidebar.getByRole('button', { name: 'Library' });
    library.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('view=library');
    expect(library).toHaveAttribute('aria-current', 'page');
    expect(sidebar.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    await userEvent.click(sidebar.getByRole('button', { name: 'My Business' }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=business');
  });
  it('localizes the section headings in Bahasa Malaysia', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    await mount(<Dashboard />, repo);
    const sidebar = await sidebarQueries();
    for (const name of ['Ringkasan', 'Kerja', 'Ruang kerja']) expect(sidebar.getByRole('group', { name })).toBeInTheDocument();
  });
  it('places available Routines and Goals in Work without starting any work', async () => {
    const routines = { list: vi.fn(async () => listFixture()), read: vi.fn(), occurrences: vi.fn(), execute: vi.fn() } satisfies RoutinesApi;
    const repo = Object.assign(new LocalRepository(), { routines, goals: vi.fn(async () => ({ canManage: false, goals: [] })) });
    await mount(<Dashboard />, repo, '/app', { routinesVersion: 1 });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).getAllByRole('button').map(button => button.textContent?.replace(/\d+$/, ''))).toEqual(['Activity', 'Routines', 'Goals']);
    expect(routines.list).not.toHaveBeenCalled();
    expect(routines.execute).not.toHaveBeenCalled();
  });
  it.each([undefined, 2])('does not expose Routines without supported discovery: %s', async routinesVersion => {
    const routines = { list: vi.fn(async () => listFixture()), read: vi.fn(), occurrences: vi.fn(), execute: vi.fn() } satisfies RoutinesApi;
    const repo = Object.assign(new LocalRepository(), { routines });
    await mount(<Dashboard />, repo, '/app', { routinesVersion });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).queryByRole('button', { name: 'Routines' })).toBeNull();
    expect(routines.list).not.toHaveBeenCalled();
    expect(routines.execute).not.toHaveBeenCalled();
  });
  it('does not expose account-only Routines or Goals in the anonymous demo', async () => {
    const routines = { list: vi.fn(async () => listFixture()), read: vi.fn(), occurrences: vi.fn(), execute: vi.fn() } satisfies RoutinesApi;
    const repo = Object.assign(new LocalRepository(), { routines, goals: vi.fn(async () => ({ canManage: false, goals: [] })) });
    await mount(<Dashboard />, repo, '/app', { signedIn: false, routinesVersion: 1 });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).queryByRole('button', { name: 'Routines' })).toBeNull();
    expect(within(work).queryByRole('button', { name: 'Goals' })).toBeNull();
    expect(repo.goals).not.toHaveBeenCalled();
    expect(routines.list).not.toHaveBeenCalled();
    expect((await sidebarQueries()).queryByRole('progressbar')).toBeNull();
  });
  it('exposes the selected mode and only shows a real attention count', async () => {
    const change = vi.fn();
    await mount(<WorkspaceModeSwitch mode="chat" onChange={change} needsAttention={2} />);
    const modes = await screen.findByRole('navigation', { name: 'Workspace mode' });
    expect(within(modes).getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    expect(change).toHaveBeenCalledWith('dashboard');
    expect(screen.getByLabelText('2 waiting for your review')).toBeInTheDocument();
  });

  it('keeps drafts and the last business tab when switching modes and using browser Back', async () => {
    function Location() {
      const { search } = useLocation();
      const navigate = useNavigate();
      return <><output data-testid="location">{search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
    }
    const user = userEvent.setup();
    await mount(<><Dashboard /><Location /></>, undefined, '/app?view=business&tab=handles');
    const modes = await screen.findByRole('navigation', { name: 'Workspace mode' });
    await user.click(within(modes).getByRole('button', { name: 'Chat' }));
    const composer = screen.getByRole('textbox');
    await user.type(composer, 'Notes for our quotation');
    await user.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=business&tab=handles');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByRole('textbox')).toBe(composer);
    expect(composer).toHaveValue('Notes for our quotation');
    expect(document.querySelector('.dashboard-sidebar')).toBeNull();
    expect(document.querySelector('.dashboard-bottom-nav')).toBeNull();
  });

  it('finishes a pending reply while Dashboard is open without making another request', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    let finish!: (answer: AskAnswer) => void;
    repo.ask = vi.fn(() => new Promise<AskAnswer>((resolve) => { finish = resolve; }));
    await mount(<Dashboard />, repo, '/app?view=chat');
    await user.type(await screen.findByRole('textbox'), 'Prepare a customer reply');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(repo.ask).toHaveBeenCalledOnce());
    const modes = screen.getByRole('navigation', { name: 'Workspace mode' });
    await user.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    await act(async () => finish({ text: 'Your draft is ready.', grounded: false, usedKeys: [] }));
    await user.click(within(modes).getByRole('button', { name: 'Chat' }));
    expect(document.querySelector('.ask-reply-text')).toHaveTextContent('Your draft is ready.');
    expect(repo.ask).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('opens the exact task from Chat and preserves that task and the draft across mode switches', async () => {
    function Location() {
      const { search } = useLocation();
      const navigate = useNavigate();
      return <><output data-testid="location">{search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
    }
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = vi.fn(async () => ({ runId, text: 'Your quotation is ready.', grounded: false, usedKeys: [], kind: 'work' as const, taskStatus: 'completed' }));
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, text: 'Full quotation, not sent.' }));
    await mount(<><Dashboard /><Location /></>, repo, '/app?view=chat');
    await user.type(await screen.findByRole('textbox'), 'Prepare a quotation');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    /* The card that used to carry this link is gone; the reply's own footer
       opens the run it produced, rather than the whole Activity list. */
    const task = await screen.findByRole('button', { name: 'View in Activity' });
    await user.type(screen.getByRole('textbox'), 'Draft for later');
    await user.click(task);
    expect(await screen.findByText('Full quotation, not sent.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`view=work&run=${runId}`);
    expect(screen.getByTestId('location')).not.toHaveTextContent('quotation');
    const modes = screen.getByRole('navigation', { name: 'Workspace mode' });
    await user.click(within(modes).getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('textbox')).toHaveValue('Draft for later');
    await user.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    expect(await screen.findByText('Full quotation, not sent.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`view=work&run=${runId}`);
    await user.click(screen.getByRole('button', { name: 'All activity' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('run=');
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByText('Full quotation, not sent.')).toBeInTheDocument();
    expect(repo.ask).toHaveBeenCalledOnce();
  });

  it('keeps older replies without run IDs linked to general Activity', async () => {
    const repo = new LocalRepository();
    localStorage.setItem('jentera-ask-sessions-v1:workspace-modes-test', JSON.stringify([{
      id: 'old-chat', title: 'Older work', createdAt: 1, updatedAt: 1,
      messages: [{ from: 'ai', text: 'An older reply', state: 'done', mode: 'work' }],
    }]));
    repo.runResult = vi.fn();
    await mount(<Dashboard />, repo, '/app?view=chat');
    await userEvent.click(await screen.findByRole('button', { name: 'View in Activity' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(repo.runResult).not.toHaveBeenCalled();
  });

  it('offers status checking instead of resending an accepted task when its reply is interrupted', async () => {
    const repo = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = vi.fn(async (_question, options) => {
      options?.onRunCreated?.(runId);
      throw new Error('Connection lost');
    });
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, text: 'The task did finish.' }));
    const user = userEvent.setup();
    await mount(<Dashboard />, repo, '/app?view=chat');
    await user.type(await screen.findByRole('textbox'), 'Prepare a quotation');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Check this task before sending it again. It may still be running.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Check task status/ }));
    expect(await screen.findByText('The task did finish.')).toBeInTheDocument();
    expect(repo.ask).toHaveBeenCalledOnce();
  });

  it('adds Apps after Activity, and to the phone bar before More, when apps are on', async () => {
    const repo = Object.assign(new LocalRepository(), { apps: fakeAppsApi() });
    await mount(<Dashboard />, repo, '/app', { appsVersion: 1 });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).getAllByRole('button').map(button => button.textContent?.replace(/\d+$/, ''))).toEqual(['Activity', 'Apps']);
    const mobile = document.querySelector('.dashboard-bottom-nav')!;
    expect([...mobile.querySelectorAll(':scope > button')].slice(0, 4).map(button => button.textContent))
      .toEqual(['Home', 'Activity2', 'Chat', 'Apps']);
  });
  it.each([undefined, 2])('keeps Apps hidden without supported discovery: %s', async appsVersion => {
    const apps = fakeAppsApi();
    const repo = Object.assign(new LocalRepository(), { apps });
    await mount(<Dashboard />, repo, '/app', { appsVersion });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).queryByRole('button', { name: 'Apps' })).toBeNull();
    expect(apps.list).not.toHaveBeenCalled();
  });
  it('keeps Apps out of the anonymous demo', async () => {
    const apps = fakeAppsApi();
    const repo = Object.assign(new LocalRepository(), { apps });
    await mount(<Dashboard />, repo, '/app', { signedIn: false, appsVersion: 1 });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).queryByRole('button', { name: 'Apps' })).toBeNull();
    expect(apps.list).not.toHaveBeenCalled();
  });
  it('falls back to Home when a link asks for apps that are not on', async () => {
    const apps = fakeAppsApi();
    await mount(<Dashboard />, Object.assign(new LocalRepository(), { apps }), '/app?view=apps&app=bookings', {});
    const sidebar = await sidebarQueries();
    expect(sidebar.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(apps.list).not.toHaveBeenCalled();
  });
  it('opens the Apps list from view=apps', async () => {
    const repo = Object.assign(new LocalRepository(), { apps: fakeAppsApi() });
    await mount(<Dashboard />, repo, '/app?view=apps', { appsVersion: 1 });
    expect(await screen.findByRole('heading', { name: 'Apps', level: 1 })).toBeInTheDocument();
  });
  it('opens a booking straight from its notification link', async () => {
    const apps = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
      booking: vi.fn(async () => bookingFixture({ startsAt: '2026-12-04T02:00:00.000Z' })),
    });
    const repo = Object.assign(new LocalRepository(), { apps });
    await mount(<Dashboard />, repo, `/app?view=apps&app=bookings&booking=${BOOKING_ID}`, { appsVersion: 1 });
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    expect(within(pinned).getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(apps.booking).toHaveBeenCalledWith(BOOKING_ID);
  });
  it('puts an Alerts bell in the top bar only once an app is installed', async () => {
    const withApp = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
    });
    await mount(<Dashboard />, Object.assign(new LocalRepository(), { apps: withApp }), '/app', { appsVersion: 1 });
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument();
  });
  it('shows no bell while nothing is installed', async () => {
    const empty = fakeAppsApi();
    await mount(<Dashboard />, Object.assign(new LocalRepository(), { apps: empty }), '/app', { appsVersion: 1 });
    await waitFor(() => expect(empty.list).toHaveBeenCalled());
    // The Home tile is named "Alerts" plus its detail, so only the bell matches exactly.
    expect(screen.queryByRole('button', { name: 'Alerts' })).toBeNull();
  });
});

describe('conversation sidebar', () => {
  it('sorts recent chats and searches both titles and message text without changing the active chat', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    await mount(<ConversationList sessions={sessions} activeId="newer" businessName="Kedai Kita" onOpen={open} onNew={vi.fn()} onDelete={vi.fn()} />);
    const search = await screen.findByRole('searchbox', { name: 'Search chats' });
    expect(screen.getAllByRole('button', { name: /Open chat:/ })[0]).toHaveAccessibleName('Open chat: Catering quotation');
    await user.type(search, 'KOPI BEANS');
    expect(screen.getAllByRole('button', { name: /Open chat:/ })).toHaveLength(1);
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open chat: Supplier notes' }));
    expect(open).toHaveBeenCalledWith('older');
    await user.clear(search);
    await user.type(search, 'no matches');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(screen.getAllByRole('button', { name: /Open chat:/ })).toHaveLength(2);
  });

  it('requires confirmation to delete and protects chats with a pending reply', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    await mount(<ConversationList sessions={sessions} activeId="newer" businessName="Kedai Kita" onOpen={vi.fn()} onNew={vi.fn()} onDelete={remove} />);
    expect(await screen.findByRole('button', { name: 'Delete chat: Catering quotation' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Delete chat: Supplier notes' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete chat: Supplier notes' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('older');
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveFocus();
  });
});
