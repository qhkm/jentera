/* The owner's private instruction channel. No customer-facing capabilities are implied. */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpenText,
  ChatCircleText,
  ClipboardText,
  ListChecks,
  LockSimple,
  Notepad,
  Plus,
} from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsk } from '@/hooks/useAsk';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { useConversationScroll } from '@/hooks/useConversationScroll';
import { useMentions } from '@/hooks/useMentions';
import { useActivity } from '@/hooks/useActivity';
import { DataIcon } from '@/components/Icon';
import { JenteraMark } from '@/components/JenteraMark';
import { ChatHistory } from '@/components/ChatHistory';
import { ChatWorkspace } from '@/components/ChatWorkspace';
import { AskReply } from '@/components/AskReply';
import { useSignedIn } from '@/lib/repo/gate';
import { useSnapshot, type AskMode } from '@/lib/repo';
import type { Business } from '@/lib/types';

const STARTERS = [
  { key: 'reply', icon: ChatCircleText },
  { key: 'plan', icon: ListChecks },
  { key: 'notes', icon: Notepad },
  { key: 'update', icon: ClipboardText },
] as const;

export default function AskJenteraView({
  business,
  handled,
  needs,
  firstRun = false,
  active = true,
  workspace = false,
  onOpenActivity,
  onOpenConnections,
  onOpenKnowledge,
}: {
  business: Business;
  handled: number;
  needs: number;
  firstRun?: boolean;
  active?: boolean;
  workspace?: boolean;
  onOpenActivity?: (runId?: string, title?: string) => void;
  onOpenConnections?: () => void;
  onOpenKnowledge?: () => void;
}) {
  const { t, lang } = useI18n();
  const compact = useIsCompact();
  const snapshot = useSnapshot();
  const activity = useActivity();
  const onAskCompleted = useCallback(() => activity.reload(), [activity.reload]);
  const ask = useAsk(business, { handled, needs }, t, lang, onAskCompleted);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[ask.activeId] ?? '';
  const signedIn = useSignedIn();
  const composer = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentions(business.team);
  const scroll = useConversationScroll(ask.messages, ask.activeId, active);
  const mentionId = useId();
  const hintId = useId();
  const busy = ask.messages.some((message) => Boolean(message.pendingId));
  const confirmed = snapshot.facts.filter((fact) => fact.confirmed).length;
  const recent = ask.sessions
    .filter((session) => session.id !== ask.activeId && session.messages.length > 0)
    .slice(0, 3);
  const canRefine =
    !busy && ask.messages.at(-1)?.from === 'ai' && !ask.messages.at(-1)?.failedQuestion;

  function setDraft(value: string) {
    setDrafts((current) => ({ ...current, [ask.activeId]: value }));
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

  function prepare(text: string) {
    setDraft(text);
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

  function submit(text = draft, mode: AskMode = 'work') {
    const body = text.trim();
    if (!body || busy) return;
    scroll.jumpToLatest();
    ask.send(body, mode);
    setDraft('');
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
            onClick={ask.newSession}
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
                  </div>
                ) : (
                  <AskReply
                    key={`${ask.activeId}-${index}`}
                    message={message}
                    onRetry={() =>
                      submit(message.failedQuestion ?? '', message.failedMode ?? 'work')
                    }
                    onOpenActivity={onOpenActivity}
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

          <form
            className="ask-writing-pad"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
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
            <textarea
              ref={composer}
              rows={ask.hasHistory ? 1 : 3}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                mentions.sync(
                  event.target.value,
                  event.target.selectionStart ?? event.target.value.length,
                );
              }}
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
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              aria-haspopup="listbox"
              aria-activedescendant={mentions.open ? `${mentionId}-${mentions.active}` : undefined}
              aria-controls={mentions.open ? mentionId : undefined}
              aria-autocomplete="list"
              aria-label={t('ask.studio.placeholder')}
              aria-describedby={hintId}
              placeholder={t(
                ask.hasHistory
                  ? 'ask.studio.followup'
                  : compact
                    ? 'ask.studio.placeholder.short'
                    : 'ask.studio.placeholder',
              )}
            />
            <div className="ask-writing-footer">
              {onOpenKnowledge ? (
                <button type="button" className="ask-context-link" onClick={onOpenKnowledge}>
                  <BookOpenText size={15} aria-hidden="true" />
                  <span>
                    {t(confirmed ? 'ask.studio.knowledge' : 'ask.studio.teach', { n: confirmed })}
                  </span>
                </button>
              ) : (
                <span className="ask-context-link">
                  <LockSimple size={14} aria-hidden="true" />
                  {t('ask.private')}
                </span>
              )}
              <button
                type="submit"
                className="ask-studio-send"
                disabled={!draft.trim() || busy}
                aria-label={t('ask.studio.send')}
              >
                <ArrowUp size={20} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </form>
          <p className="ask-writing-hint" id={hintId}>
            {t(
              busy ? 'ask.studio.busy' : compact ? 'ask.studio.mobileHint' : 'ask.studio.keyboard',
            )}
          </p>
        </div>

        {!ask.hasHistory && (
          <div className="ask-studio-extras">
            <div
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
            </div>
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
    >
      {conversation}
    </ChatWorkspace>
  ) : conversation;
}
