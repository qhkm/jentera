/* The owner's private instruction channel. No customer-facing capabilities are implied. */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChatCircleText,
  ClipboardText,
  Globe,
  Hammer,
  ListChecks,
  LockSimple,
  MagnifyingGlass,
  Notepad,
  Paperclip,
  Plus,
  Target,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import { useSharedChats } from '@/hooks/useSharedChats';
import { useAsk } from '@/hooks/useAsk';
import { useChatPreview } from '@/hooks/useChatPreview';
import { Link } from 'react-router';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { useConversationScroll } from '@/hooks/useConversationScroll';
import { useMentions } from '@/hooks/useMentions';
import { useActivity } from '@/hooks/useActivity';
import { DataIcon } from '@/components/Icon';
import { JenteraMark } from '@/components/JenteraMark';
import { ChatHistory } from '@/components/ChatHistory';
import { ChatWorkspace } from '@/components/ChatWorkspace';
import { AskReply } from '@/components/AskReply';
import BusinessBrowser from './BusinessBrowser';
import { useTeamEnabled, useSignedIn } from '@/lib/repo/gate';
import { type AskMode, type RuntimeSkill } from '@/lib/repo';
import type { Business } from '@/lib/types';
import { formatBytes } from '@/lib/artifacts';

const STARTERS = [
  { key: 'reply', icon: ChatCircleText },
  { key: 'plan', icon: ListChecks },
  { key: 'notes', icon: Notepad },
  { key: 'update', icon: ClipboardText },
] as const;

const CHAT_FILE_ACCEPT = '.txt,.md,.csv,.json,.pdf,.docx,.xlsx,.pptx,.html,.png,.jpg,.jpeg,.webp';
const CHAT_FILE_LIMIT = 8 * 1024 * 1024;
const CHAT_TEXT_FILE_LIMIT = 1024 * 1024;

export default function AskJenteraView({
  business,
  handled,
  needs,
  firstRun = false,
  active = true,
  workspace = false,
  onOpenActivity,
  onOpenConnections,
  taskDraft,
}: {
  business: Business;
  handled: number;
  needs: number;
  firstRun?: boolean;
  active?: boolean;
  workspace?: boolean;
  onOpenActivity?: (runId?: string, title?: string) => void;
  onOpenConnections?: () => void;
  taskDraft?: { text: string; key: number; sessionId?: string; goalId?: string; goalTitle?: string; goalCheckpointId?: string; goalCheckpointTitle?: string } | null;
}) {
  const { t, lang } = useI18n();
  const compact = useIsCompact();
  const activity = useActivity();
  const onAskCompleted = useCallback(() => activity.reload(), [activity.reload]);
  const ask = useAsk(business, { handled, needs }, t, lang, onAskCompleted);
  /* Shared chats exist only on the team plan; the hook reads nothing otherwise. */
  const teamEnabled = useTeamEnabled();
  const sharedChats = useSharedChats(teamEnabled);
  const repo = useRepository();
  const openShared = useCallback(async (chatId: string) => {
    if (!repo.chat) return;
    try {
      ask.importSession(await repo.chat(chatId));
    } catch {
      /* The list will show it again; nothing to do here. */
    }
  }, [repo, ask]);
  const shared = teamEnabled && sharedChats.workspaces.length > 0 ? {
    workspaces: sharedChats.workspaces,
    loading: sharedChats.loading,
    onOpenShared: (chatId: string) => { void openShared(chatId); },
    onNewIn: (workspaceId: string) => { ask.newSession(undefined, workspaceId); },
  } : undefined;
  const activeSession = ask.sessions.find((session) => session.id === ask.activeId);
  const activeWorkspace = sharedChats.workspaces.find((w) => w.id === activeSession?.workspaceId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[ask.activeId] ?? '';
  const [attachments, setAttachments] = useState<Record<string, File | undefined>>({});
  const attachment = attachments[ask.activeId];
  const [attachmentError, setAttachmentError] = useState('');
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillCatalogue, setSkillCatalogue] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error'; skills: RuntimeSkill[];
  }>({ status: 'idle', skills: [] });
  const [skillSelections, setSkillSelections] = useState<Record<string, string[]>>({});
  const selectedSkillIds = skillSelections[ask.activeId] ?? [];
  const skillButton = useRef<HTMLButtonElement>(null);
  const skillPicker = useRef<HTMLDivElement>(null);
  const skillSearch = useRef<HTMLInputElement>(null);
  const signedIn = useSignedIn();
  const preview = useChatPreview(signedIn);
  const previewExhausted = preview?.remaining === 0;
  /* 'unknown' is not a third kind of pause: it is the honest answer when the
     check itself failed. Rendering it as 'paused' asserted a fact we had not
     verified, and because sending is blocked while paused, the refresh that
     would correct it could not run — the panel deadlocked itself. */
  const [browserControl, setBrowserControl] = useState<'ready' | 'paused' | 'unknown'>('ready');
  /* Only a verified pause blocks sending. When the check failed we say so and
     let the message through: the send path surfaces real runtime
     unavailability itself, and refusing on a guess is what left a phone with
     no way forward. */
  const browserPaused = browserControl === 'paused';
  const [browserOpenRequest, setBrowserOpenRequest] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const consumedDraft = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !taskDraft || consumedDraft.current === taskDraft.key) return;
    consumedDraft.current = taskDraft.key;
    const id = ask.newSession(taskDraft.sessionId, undefined, taskDraft.goalId, taskDraft.goalTitle, taskDraft.goalCheckpointId, taskDraft.goalCheckpointTitle);
    setDrafts((current) => ({ ...current, [id]: current[id]?.startsWith(taskDraft.text)
      ? current[id] : current[id]?.trim() ? `${taskDraft.text}\n\n${current[id]}` : taskDraft.text }));
    composer.current?.focus();
  }, [active, taskDraft, ask.newSession]);
  const mentions = useMentions(business.team);
  const scroll = useConversationScroll(ask.messages, ask.activeId, active);
  const mentionId = useId();
  const hintId = useId();
  const browserPausedId = useId();
  const busy = ask.messages.some((message) => Boolean(message.pendingId));
  const recent = ask.sessions
    .filter((session) => session.id !== ask.activeId && session.messages.length > 0)
    .slice(0, 3);
  const canRefine =
    !previewExhausted && !busy && ask.messages.at(-1)?.from === 'ai' && !ask.messages.at(-1)?.failedQuestion;

  useEffect(() => setAttachmentError(''), [ask.activeId]);

  const loadSkills = useCallback(async () => {
    setSkillCatalogue(current => ({ status: 'loading', skills: current.skills }));
    try {
      setSkillCatalogue({ status: 'ready', skills: await repo.runtimeSkills() });
    } catch {
      setSkillCatalogue(current => ({ status: 'error', skills: current.skills }));
    }
  }, [repo]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!skillPicker.current?.contains(target) && !skillButton.current?.contains(target)) {
        setSkillPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [skillPickerOpen]);

  useEffect(() => {
    setSkillPickerOpen(false);
    setSkillQuery('');
  }, [ask.activeId]);

  const visibleSkills = skillCatalogue.skills.filter(skill => {
    const query = skillQuery.trim().toLocaleLowerCase();
    return !query || skill.name.toLocaleLowerCase().includes(query) ||
      skill.description.toLocaleLowerCase().includes(query) ||
      skill.category?.toLocaleLowerCase().includes(query);
  });

  function openSkillPicker() {
    const next = !skillPickerOpen;
    setSkillPickerOpen(next);
    if (next) {
      if (skillCatalogue.status === 'idle') void loadSkills();
      requestAnimationFrame(() => skillSearch.current?.focus());
    }
  }

  function toggleSkill(id: string) {
    setSkillSelections(current => {
      const selected = current[ask.activeId] ?? [];
      const next = selected.includes(id)
        ? selected.filter(value => value !== id)
        : selected.length < 5 ? [...selected, id] : selected;
      return { ...current, [ask.activeId]: next };
    });
  }

  function setDraft(value: string) {
    setDrafts((current) => ({ ...current, [ask.activeId]: value }));
  }

  function setAttachment(file?: File) {
    setAttachmentError('');
    const textLike = file && /\.(?:txt|md|csv|json)$/i.test(file.name);
    if (file && file.size > (textLike ? CHAT_TEXT_FILE_LIMIT : CHAT_FILE_LIMIT)) {
      setAttachmentError(t('ask.attachment.tooLarge'));
      return;
    }
    if (file) ask.warm('attach');
    setAttachments((current) => ({ ...current, [ask.activeId]: file }));
  }

  // One composer stays mounted: typing, selection and per-chat drafts survive layout changes.
  useEffect(() => {
    if (!active) return;
    const element = composer.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
    }
  }, [draft, ask.activeId, ask.hasHistory, active, compact]);

  useEffect(() => {
    mentions.close();
  }, [ask.activeId, mentions.close]);

  /* Closing owner control deliberately leaves the business browser paused.
     Check as Chat becomes active, and again when this window regains focus,
     so a hand-back in the Connections screen or another tab is reflected
     before the next message is sent. Do not poll: a status request wakes a
     sleeping business computer. */
  const refreshBrowserControl = useCallback((cancelled?: { current: boolean }) => {
      void repo.businessBrowser().then((state) => {
        if (!cancelled?.current) setBrowserControl(state.paused === true ? 'paused' : 'ready');
      }).catch(() => {
        /* Never turn a failed check into a "ready" signal — but do not claim
           it is paused either. Say so, and offer a retry the person can tap:
           the refresh is not on a timer because polling wakes a sleeping
           business computer, so without one there is nothing to break the tie. */
        if (!cancelled?.current) setBrowserControl((current) => (current === 'paused' ? 'paused' : 'unknown'));
      });
  }, [repo]);

  useEffect(() => {
    if (!active || !signedIn) {
      if (!signedIn) setBrowserControl('ready');
      return;
    }
    const cancelled = { current: false };
    const refresh = () => refreshBrowserControl(cancelled);
    const onVisibility = () => { if (!document.hidden) refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled.current = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, signedIn, refreshBrowserControl]);

  function prepare(text: string) {
    setDraft(text);
    mentions.close();
    composer.current?.focus();
  }

  function prepareContinuation(text: string, sessionId?: string) {
    const id = sessionId || ask.activeId;
    if (id !== ask.activeId) ask.newSession(id);
    setDrafts((current) => ({
      ...current,
      [id]: current[id]?.startsWith(text) ? current[id] : current[id]?.trim() ? `${text}\n\n${current[id]}` : text,
    }));
    mentions.close();
    composer.current?.focus();
  }

  function choose(member: (typeof business.team)[number]) {
    const element = composer.current;
    if (!element) return;
    const { value, caret } = mentions.complete(
      element.value,
      element.selectionStart ?? element.value.length,
      member,
    );
    setDraft(value);
    mentions.close();
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  }

  function submit(text = draft, mode?: AskMode) {
    const body = text.trim() || (attachment ? t('ask.attachment.defaultPrompt') : '');
    if (!body || browserPaused || previewExhausted) return;
    scroll.jumpToLatest();
    ask.send(body, preview ? 'work' : mode, attachment, selectedSkillIds);
    setDraft('');
    setAttachment(undefined);
    setSkillSelections(current => ({ ...current, [ask.activeId]: [] }));
    setSkillPickerOpen(false);
    setSkillQuery('');
    if (filePicker.current) filePicker.current.value = '';
    mentions.close();
    if (compact) composer.current?.blur();
    else composer.current?.focus();
  }

  const conversation = (
    <div
      className={`chat-shell ask-studio ${ask.hasHistory ? 'ask-studio-conversation' : 'ask-studio-start'}`}
    >
      <header className="ask-studio-topbar">
        <h1>{t('view.chat')}</h1>
        {activeWorkspace && (
          <span className="ask-shared-badge"><UsersThree size={14} aria-hidden="true" />{t('chat.shared.badge', { name: activeWorkspace.name })}</span>
        )}
        {activeSession?.goalId && (
          <span className="ask-goal-badge" title={activeSession.goalTitle ?? t('goals.chat')}>
            <Target size={14} weight="duotone" aria-hidden="true" />
            <span>
              <small>{t(activeSession.goalCheckpointId ? 'goals.chat.step' : 'goals.chat')}</small>
              {activeSession.goalCheckpointTitle ?? activeSession.goalTitle ?? t('goals.title')}
            </span>
          </span>
        )}
        <div className="ask-studio-tools">
          {!workspace && (signedIn || ask.sessions.length > 1) && (
            <ChatHistory
              sessions={ask.sessions}
              activeId={ask.activeId}
              onOpen={ask.openSession}
              onDelete={ask.deleteSession}
            />
          )}
          <button
            type="button"
            className="ask-studio-new"
            onClick={() => ask.newSession()}
            aria-label={t('ask.newChat')}
          >
            <Plus size={17} aria-hidden="true" />
            <span>{t('ask.newChat')}</span>
          </button>
        </div>
      </header>

      <div className="ask-studio-body">
        <div
          className="ask-studio-stream"
          ref={scroll.viewport}
          onScroll={scroll.onScroll}
          tabIndex={ask.hasHistory ? 0 : undefined}
          role={ask.hasHistory ? 'region' : undefined}
          aria-label={ask.hasHistory ? t('ask.conversation') : undefined}
        >
          {ask.hasHistory ? (
            <div className="ask-transcript">
              <h2 className="sr-only">{t('ask.conversation')}</h2>
              {ask.messages.map((message, index) =>
                message.from === 'you' ? (
                  <div className="ask-owner-message" key={`${ask.activeId}-${index}`}>
                    <span>{t('ask.you')}</span>
                    <p>{message.text}</p>
                    {message.inputFiles?.map((file) => (
                      <span className="ask-owner-attachment" key={file.name}>
                        <Paperclip size={13} aria-hidden="true" />
                        {file.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <AskReply
                    key={`${ask.activeId}-${index}`}
                    message={{ ...message, taskTitle: message.taskTitle ?? ask.messages[index - 1]?.text }}
                    onRetry={() => {
                      if (message.inputFiles?.length) {
                        setDraft(message.failedQuestion ?? '');
                        filePicker.current?.click();
                      } else {
                        submit(message.failedQuestion ?? '', message.failedMode ?? 'work');
                      }
                    }}
                    onOpenActivity={onOpenActivity}
                    onOpenBusinessBrowser={signedIn ? () => setBrowserOpenRequest(n => n + 1) : undefined}
                    onContinueTask={signedIn && !busy ? prepareContinuation : undefined}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="ask-studio-welcome">
              <div className="ask-studio-emblem" aria-hidden="true">
                <JenteraMark size={48} />
                <span />
                <span />
              </div>
              <p className="ask-studio-business">{business.name}</p>
              <h2>{t('ask.studio.title')}</h2>
              <p className="ask-studio-intro">
                {t(firstRun ? 'ask.welcome.first' : 'ask.studio.detail')}
              </p>
            </div>
          )}
        </div>

        <div className="ask-writing-zone">
          {ask.hasHistory && scroll.away && (
            <button type="button" className="ask-jump-latest" onClick={scroll.jumpToLatest}>
              <ArrowDown size={15} aria-hidden="true" />
              <span aria-live="polite">
                {t(scroll.unread ? 'ask.studio.unread' : 'ask.studio.latest')}
              </span>
            </button>
          )}
          {ask.hasHistory && canRefine && (
            <div className="ask-refinements" role="group" aria-label={t('ask.studio.refine')}>
              {['short', 'checklist'].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => prepare(t(`ask.refine.${key}.prompt`))}
                >
                  {t(`ask.refine.${key}`)}
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          {browserControl !== 'ready' && (
            <div className="ask-browser-paused" id={browserPausedId} role="status">
              <Globe size={20} weight="duotone" aria-hidden="true" />
              <div>
                <strong>{t(browserControl === 'paused' ? 'ask.browserPaused.title' : 'ask.browserUnknown.title')}</strong>
                <p>{t(browserControl === 'paused' ? 'ask.browserPaused.detail' : 'ask.browserUnknown.detail')}</p>
              </div>
              {browserControl === 'paused' ? (
                <button type="button" onClick={() => setBrowserOpenRequest(n => n + 1)}>
                  {t('ask.browserPaused.action')}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : (
                <button type="button" onClick={() => refreshBrowserControl()}>
                  {t('ask.browserUnknown.action')}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {preview && !previewExhausted && <div className="ask-preview-banner" role="status">
            <span>{lang === 'bm' ? preview.remaining + ' daripada 10 chat percuma berbaki' : preview.remaining + ' of 10 free chats left'}</span>
            <Link to="/subscribe">{lang === 'bm' ? 'Naik taraf' : 'Upgrade'}<ArrowRight size={14} aria-hidden="true" /></Link>
          </div>}
          {previewExhausted ? <section className="ask-preview-upgrade" aria-labelledby="preview-upgrade-heading">
            <h3 id="preview-upgrade-heading">{lang === 'bm' ? '10 chat percuma anda telah digunakan.' : 'Your 10 free chats are complete.'}</h3>
            <p>{lang === 'bm' ? 'Naik taraf untuk terus memberi kerja kepada Jentera. Permintaan yang sedang berjalan boleh selesai dan hasil terdahulu masih boleh dibaca.' : 'Upgrade to keep giving Jentera work. Requests already in progress can finish, and previous results stay readable.'}</p>
            <Link to="/subscribe" className="btn btn-primary">{lang === 'bm' ? 'Naik taraf — RM99/bulan' : 'Upgrade — RM99/month'}<ArrowRight size={16} aria-hidden="true" /></Link>
            <small>{lang === 'bm' ? 'RM99/bulan untuk 3 bulan pertama, kemudian RM199/bulan.' : 'RM99/month for your first 3 months, then RM199/month.'}</small>
          </section> : <form
            className="ask-writing-pad"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              ref={filePicker}
              className="ask-file-input"
              type="file"
              accept={CHAT_FILE_ACCEPT}
              aria-label={t('ask.attachment.choose')}
              onChange={(event) => setAttachment(event.target.files?.[0])}
            />
            {mentions.open && (
              <ul
                id={mentionId}
                role="listbox"
                aria-label={t('ask.studio.mentions')}
                className="ask-mention-list"
              >
                {mentions.matches.map((member, index) => (
                  <li key={member.n} role="presentation">
                    <button
                      type="button"
                      role="option"
                      tabIndex={-1}
                      id={`${mentionId}-${index}`}
                      aria-selected={index === mentions.active}
                      onMouseEnter={() => mentions.setActive(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(member);
                      }}
                      onClick={() => choose(member)}
                    >
                      <DataIcon emoji={member.e} size={16} />
                      <span>{member.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {attachment && (
              <div className="ask-selected-file" role="status">
                <Paperclip size={18} aria-hidden="true" />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>{formatBytes(attachment.size)}</small>
                </span>
                <button
                  type="button"
                  aria-label={t('ask.attachment.remove', { name: attachment.name })}
                  onClick={() => {
                    setAttachment(undefined);
                    if (filePicker.current) filePicker.current.value = '';
                  }}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            )}
            {attachmentError && <p className="ask-attachment-error" role="alert">{attachmentError}</p>}
            {selectedSkillIds.length > 0 && <div className="ask-selected-skills" aria-label={t('ask.skills.selected', { n: selectedSkillIds.length })}>
              {selectedSkillIds.map(id => {
                const skill = skillCatalogue.skills.find(item => item.id === id);
                return <button key={id} type="button" onClick={() => toggleSkill(id)} aria-label={`${t('ask.skills.remove')} ${skill?.name ?? id}`}>
                  <Hammer size={13} aria-hidden="true" /><span>{skill?.name ?? id}</span><X size={12} aria-hidden="true" />
                </button>;
              })}
            </div>}
            <textarea
              ref={composer}
              rows={ask.hasHistory ? 1 : 3}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (event.target.value.trim()) ask.warm('typing');
                mentions.sync(
                  event.target.value,
                  event.target.selectionStart ?? event.target.value.length,
                );
              }}
              onFocus={() => ask.warm('focus')}
              onClick={(event) =>
                mentions.sync(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                )
              }
              onBlur={() => mentions.close()}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (mentions.open) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    mentions.move(event.key === 'ArrowDown' ? 1 : -1);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    choose(mentions.matches[mentions.active]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    mentions.close();
                    return;
                  }
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
              aria-haspopup="listbox"
              aria-activedescendant={mentions.open ? `${mentionId}-${mentions.active}` : undefined}
              aria-controls={mentions.open ? mentionId : undefined}
              aria-autocomplete="list"
              aria-label={t('ask.studio.placeholder')}
              aria-describedby={browserPaused ? `${hintId} ${browserPausedId}` : hintId}
              placeholder={t(
                ask.hasHistory
                  ? 'ask.studio.followup'
                  : compact
                    ? 'ask.studio.placeholder.short'
                    : 'ask.studio.placeholder',
              )}
            />
            <div className="ask-writing-footer">
              <div className="ask-writing-tools">
                <button
                  type="button"
                  className="ask-attach-button"
                  aria-label={t(attachment ? 'ask.attachment.replace' : 'ask.attachment.add')}
                  title={t(attachment ? 'ask.attachment.replace' : 'ask.attachment.add')}
                  onClick={() => filePicker.current?.click()}
                >
                  <Paperclip size={15} aria-hidden="true" />
                  <span>{t(attachment ? 'ask.toolbar.replace' : 'ask.toolbar.attach')}</span>
                </button>
                {signedIn && <>
                  <button
                    ref={skillButton}
                    type="button"
                    className="ask-context-link"
                    onClick={openSkillPicker}
                    aria-haspopup="dialog"
                    aria-expanded={skillPickerOpen}
                    aria-label={t('ask.skills.open')}
                    title={t('ask.skills.open')}
                  >
                    <Hammer size={15} aria-hidden="true" />
                    <span>{t('ask.toolbar.skills')}</span>
                    {selectedSkillIds.length > 0 && <span className="ask-context-count" aria-hidden="true">{selectedSkillIds.length}</span>}
                  </button>
                  {skillPickerOpen && <div ref={skillPicker} className="ask-skill-picker" role="dialog" aria-label={t('ask.skills.title')}>
                    <header>
                      <div><strong>{t('ask.skills.title')}</strong><span>{t('ask.skills.limit')}</span></div>
                      <button type="button" onClick={() => setSkillPickerOpen(false)} aria-label={t('ask.skills.close')}><X size={16} aria-hidden="true" /></button>
                    </header>
                    <label className="ask-skill-search">
                      <MagnifyingGlass size={15} aria-hidden="true" />
                      <input ref={skillSearch} type="search" value={skillQuery} onChange={event => setSkillQuery(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Escape') { setSkillPickerOpen(false); skillButton.current?.focus(); } }}
                        placeholder={t('ask.skills.search')} aria-label={t('ask.skills.search')} />
                    </label>
                    <div className="ask-skill-options">
                      {skillCatalogue.status === 'loading' && skillCatalogue.skills.length === 0 ? <p role="status">{t('ask.skills.loading')}</p>
                        : skillCatalogue.status === 'error' && skillCatalogue.skills.length === 0 ? <div className="ask-skill-empty" role="alert"><span>{t('ask.skills.error')}</span><button type="button" onClick={() => void loadSkills()}>{t('skills.retry')}</button></div>
                          : visibleSkills.length === 0 ? <p>{t(skillCatalogue.skills.length ? 'ask.skills.noneFound' : 'ask.skills.empty')}</p>
                            : <ul>{visibleSkills.map(skill => {
                              const checked = selectedSkillIds.includes(skill.id);
                              const atLimit = selectedSkillIds.length >= 5 && !checked;
                              return <li key={skill.id}>
                                <label className={skill.disabled ? 'is-disabled' : undefined}>
                                  <input type="checkbox" checked={checked} disabled={skill.disabled || atLimit} onChange={() => toggleSkill(skill.id)} />
                                  <span><strong>{skill.name}</strong>{skill.description && <small>{skill.description}</small>}</span>
                                  {checked ? <Check size={16} weight="bold" aria-hidden="true" />
                                    : <em>{skill.disabled ? t('skills.disabled') : skill.category}</em>}
                                </label>
                              </li>;
                            })}</ul>}
                    </div>
                    <footer><span>{t('ask.skills.selected', { n: selectedSkillIds.length })}</span><button type="button" onClick={() => setSkillPickerOpen(false)}>{t('ask.skills.done')}</button></footer>
                  </div>}
                </>}
                {signedIn && (
                  <BusinessBrowser appearance="chat-tool" openRequest={browserOpenRequest} onPauseChange={(paused) => setBrowserControl(paused ? 'paused' : 'ready')} />
                )}
              </div>
              <div className="ask-writing-actions">
                <button
                  type="submit"
                  className="ask-studio-send"
                  disabled={(!draft.trim() && !attachment) || browserPaused}
                  aria-label={t('ask.studio.send')}
                >
                  <ArrowUp size={20} weight="bold" aria-hidden="true" />
                </button>
              </div>
            </div>
          </form>}
          <p className="ask-writing-hint ask-ai-disclaimer" id={hintId}>
            <span>{t('ask.studio.disclaimer')}</span>
            <span className="sr-only">{' '}{t(
              busy ? 'ask.studio.busy' : compact ? 'ask.studio.mobileHint' : 'ask.studio.keyboard',
            )}</span>
          </p>
        </div>

        {!ask.hasHistory && (
          <div className="ask-studio-extras">
            {!previewExhausted && <div
              className="ask-studio-starters"
              role="group"
              aria-label={t('ask.studio.startWith')}
            >
              {STARTERS.map(({ key, icon: TaskIcon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => prepare(t(`ask.starter.${key}.prompt`))}
                >
                  <TaskIcon size={16} weight="duotone" aria-hidden="true" />
                  {t(`ask.starter.${key}`)}
                </button>
              ))}
            </div>}
            {!workspace && recent.length > 0 && (
              <section className="ask-recent-chats" aria-label={t('ask.studio.recent')}>
                <header>
                  <h3>{t('ask.studio.recent')}</h3>
                  <span>{t('ask.history.device')}</span>
                </header>
                {recent.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => ask.openSession(session.id)}
                  >
                    <ChatCircleText size={17} aria-hidden="true" />
                    <span>{session.title || t('ask.chat.untitled')}</span>
                    <time dateTime={new Date(session.updatedAt).toISOString()}>
                      {new Date(session.updatedAt).toLocaleDateString(
                        lang === 'bm' ? 'ms-MY' : 'en-MY',
                        { day: 'numeric', month: 'short' },
                      )}
                    </time>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ))}
              </section>
            )}
            {signedIn &&
              activity.real &&
              activity.data!.counters.connections === 0 &&
              onOpenConnections && (
                <button type="button" className="ask-connection-nudge" onClick={onOpenConnections}>
                  <LockSimple size={14} aria-hidden="true" />
                  {t('ask.connection.open')}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );

  return workspace ? (
    <ChatWorkspace
      active={active}
      businessName={business.name}
      sessions={ask.sessions}
      activeId={ask.activeId}
      onNew={ask.newSession}
      onOpen={ask.openSession}
      onDelete={ask.deleteSession}
      shared={shared}
    >
      {conversation}
    </ChatWorkspace>
  ) : conversation;
}
