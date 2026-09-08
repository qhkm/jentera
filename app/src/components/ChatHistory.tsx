import { useEffect, useId, useRef, useState } from 'react';
import { CaretDown, ChatCircleText, ClockCounterClockwise, Trash } from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import type { AskSession } from '@/hooks/useAsk';

export function ChatHistory({
  sessions,
  activeId,
  onOpen,
  onDelete,
}: {
  sessions: AskSession[];
  activeId: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = sessions.find((session) => session.id === activeId);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
        setRemoving(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    setRemoving(null);
    trigger.current?.focus();
  }

  return (
    <div
      className="ask-history"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
          setRemoving(null);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="ask-history-trigger"
        aria-label={t('ask.history')}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen((value) => !value);
          setRemoving(null);
        }}
      >
        <ClockCounterClockwise size={18} aria-hidden="true" />
        <span>{active?.title || t('ask.chat.untitled')}</span>
        <CaretDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <section id={id} className="ask-history-panel" aria-label={t('ask.history')}>
          <header>
            <strong>{t('ask.history')}</strong>
            <span>{t('ask.history.device')}</span>
          </header>
          <ul>
            {[...sessions]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((session) => {
                const title = session.title || t('ask.chat.untitled');
                return (
                  <li key={session.id}>
                    {removing === session.id ? (
                      <div className="ask-history-confirm">
                        <span>{t('ask.history.confirm')}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setRemoving(null);
                            requestAnimationFrame(() =>
                              document.getElementById(`${id}-${session.id}-delete`)?.focus(),
                            );
                          }}
                        >
                          {t('workspace.cancel')}
                        </button>
                        <button
                          type="button"
                          autoFocus
                          onClick={() => {
                            onDelete(session.id);
                            close();
                          }}
                        >
                          {t('ask.history.remove')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-current={session.id === activeId ? 'true' : undefined}
                          aria-label={t('ask.history.open', { title })}
                          onClick={() => {
                            onOpen(session.id);
                            close();
                          }}
                        >
                          <ChatCircleText size={17} aria-hidden="true" />
                          <span>
                            <strong>{title}</strong>
                            <time dateTime={new Date(session.updatedAt).toISOString()}>
                              {new Date(session.updatedAt).toLocaleDateString(
                                lang === 'bm' ? 'ms-MY' : 'en-MY',
                                { day: 'numeric', month: 'short', year: 'numeric' },
                              )}
                            </time>
                          </span>
                        </button>
                        {sessions.length > 1 && (
                          <button
                            id={`${id}-${session.id}-delete`}
                            type="button"
                            className="ask-history-delete"
                            aria-label={t('ask.history.delete', { title })}
                            onClick={() => setRemoving(session.id)}
                          >
                            <Trash size={16} aria-hidden="true" />
                          </button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}
