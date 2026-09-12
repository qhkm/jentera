import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChatCircleText, MagnifyingGlass, Plus, SidebarSimple, Trash, X } from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import type { AskSession } from '@/hooks/useAsk';
import type { SharedWorkspace } from '@/hooks/useSharedChats';
import { UsersThree } from '@phosphor-icons/react';

export interface SharedChats {
  workspaces: SharedWorkspace[];
  loading: boolean;
  /** Bring a colleague's chat into this browser and make it current. */
  onOpenShared: (chatId: string) => void;
  onNewIn: (workspaceId: string) => void;
}

interface ConversationsProps {
  sessions: AskSession[];
  activeId: string;
  businessName: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** Present only on the team plan, for a person in at least one workspace. */
  shared?: SharedChats;
}

export function ConversationList({ sessions, activeId, businessName, onOpen, onNew, onDelete, shared }: ConversationsProps) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const newChat = useRef<HTMLButtonElement>(null);
  const id = useId();
  const search = query.trim().toLocaleLowerCase();
  const matches = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).filter((session) =>
    !search || [session.title, ...session.messages.map((message) => message.text)]
      .some((text) => text.toLocaleLowerCase().includes(search)),
  );

  useEffect(() => setRemoving(null), [activeId]);

  function start() {
    setQuery('');
    setRemoving(null);
    onNew();
  }

  return (
    <div className="conversation-list">
      <header className="conversation-list-heading">
        <h2>{t('chat.workspace.conversations')}</h2>
        <p>{businessName}</p>
      </header>
      <button className="conversation-new" type="button" ref={newChat} onClick={start}>
        <Plus size={18} aria-hidden="true" />
        {t('ask.newChat')}
      </button>
      <label className="conversation-search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label={t('chat.workspace.search')}
          placeholder={t('chat.workspace.search')}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setRemoving(null); }}
        />
      </label>
      <div className="conversation-list-scroll">
        {matches.length ? (
          <ul>
            {matches.map((session) => {
              const title = session.title || t('ask.newChat');
              const pending = session.messages.some((message) => Boolean(message.pendingId));
              const preview = [...session.messages].reverse()
                .find((message) => !message.pendingId && message.text.trim())?.text
                || t('chat.workspace.empty');
              return (
                <li key={session.id} className={session.id === activeId ? 'conversation-selected' : ''}>
                  {removing === session.id ? (
                    <div className="conversation-delete-confirm">
                      <p>{t('ask.history.confirm')}</p>
                      <div>
                        <button type="button" autoFocus onClick={() => {
                          setRemoving(null);
                          requestAnimationFrame(() => document.getElementById(`${id}-${session.id}`)?.focus());
                        }}>{t('workspace.cancel')}</button>
                        <button type="button" disabled={pending} onClick={() => {
                          onDelete(session.id);
                          setRemoving(null);
                          newChat.current?.focus();
                        }}>{t('ask.history.remove')}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="conversation-open"
                        aria-current={session.id === activeId ? 'true' : undefined}
                        aria-label={t('ask.history.open', { title })}
                        onClick={() => onOpen(session.id)}
                      >
                        <span className="conversation-title"><ChatCircleText size={16} aria-hidden="true" /><strong>{title}</strong></span>
                        <span className="conversation-preview">{preview}</span>
                        <span className="conversation-meta">
                          <time dateTime={new Date(session.updatedAt).toISOString()}>
                            {new Date(session.updatedAt).toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short' })}
                          </time>
                          {pending && <span className="conversation-pending">{t('chat.workspace.working')}</span>}
                        </span>
                      </button>
                      <button
                        id={`${id}-${session.id}`}
                        className="conversation-delete"
                        type="button"
                        disabled={pending}
                        aria-label={t('ask.history.delete', { title })}
                        onClick={() => setRemoving(session.id)}
                      ><Trash size={15} aria-hidden="true" /></button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="conversation-no-results">
            <p>{t('chat.workspace.noMatches')}</p>
            <button type="button" onClick={() => setQuery('')}>{t('chat.workspace.clearSearch')}</button>
          </div>
        )}
      </div>
      {shared && shared.workspaces.length > 0 && (
        <div className="conversation-shared">
          {shared.workspaces.map((workspace) => (
            <section key={workspace.id} aria-label={t('chat.shared.heading', { name: workspace.name })}>
              <h3><UsersThree size={15} aria-hidden="true" />{t('chat.shared.heading', { name: workspace.name })}</h3>
              <button type="button" className="conversation-new conversation-new-shared" onClick={() => shared.onNewIn(workspace.id)}>
                <Plus size={16} aria-hidden="true" />
                {t('chat.shared.new', { name: workspace.name })}
              </button>
              {workspace.chats.length === 0
                ? <p className="conversation-shared-empty">{t('chat.shared.none')}</p>
                : (
                  <ul>
                    {workspace.chats.map((chat) => {
                      const title = chat.title || t('chat.shared.untitled');
                      return (
                        <li key={chat.id} className={chat.id === activeId ? 'conversation-selected' : ''}>
                          <button
                            type="button"
                            className="conversation-open"
                            aria-label={t('chat.shared.open', { title })}
                            onClick={() => shared.onOpenShared(chat.id)}
                          >
                            <span className="conversation-title"><ChatCircleText size={16} aria-hidden="true" /><strong>{title}</strong></span>
                            <span className="conversation-meta">
                              <span>{t('chat.shared.by', { who: chat.createdBy.split('@')[0] })}</span>
                              <span>· {t('chat.shared.turns', { n: chat.turns })}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </section>
          ))}
        </div>
      )}
      <p className="conversation-storage-note">{t('ask.history.device')}</p>
    </div>
  );
}

export function ChatWorkspace({ active, children, ...conversations }: ConversationsProps & {
  active: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const close = () => dialog.current?.close();

  useEffect(() => {
    if (!active && dialog.current?.open) dialog.current.close();
  }, [active]);

  return (
    <div className="chat-workspace">
      <aside className="chat-conversations" aria-label={t('chat.workspace.conversations')}>
        <ConversationList {...conversations} />
      </aside>
      <div className="chat-main">
        <button
          className="chat-history-toggle"
          type="button"
          aria-label={t('chat.workspace.open')}
          aria-haspopup="dialog"
          aria-controls={id}
          onClick={() => dialog.current?.showModal()}
        ><SidebarSimple size={21} aria-hidden="true" /></button>
        {children}
      </div>
      <dialog
        id={id}
        className="chat-conversations-dialog"
        ref={dialog}
        aria-label={t('chat.workspace.conversations')}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <div className="chat-conversations-dialog-content">
          <button className="chat-conversations-close" type="button" onClick={close} aria-label={t('chat.workspace.close')}>
            <X size={20} aria-hidden="true" />
          </button>
          <ConversationList
            {...conversations}
            onOpen={(session) => { conversations.onOpen(session); close(); }}
            onNew={() => { conversations.onNew(); close(); }}
          />
        </div>
      </dialog>
    </div>
  );
}
