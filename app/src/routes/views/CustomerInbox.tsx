/* ============================================================
   Customer inbox — one thread per agent, like messaging your
   staff. Take over any conversation to reply as the business,
   then hand it back to the AI.

   This used to be the top-level "Chat" view. It now lives as the
   secondary tab inside Ask Jentera, so owner instructions and
   customer messages stop competing as two chat products.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Card, Input } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { Icon } from '@/components/Icon';
import { templatesFor, useChat, type ChatMessage } from '@/hooks/useChat';
import { useSignedIn } from '@/lib/repo/gate';
import type { Business } from '@/lib/types';

function Bubble({ msg }: { msg: ChatMessage }) {
  const out = msg.from === 'you';
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`bubble ${out ? 'bubble-out' : 'bubble-in'}`}>
        {!out && msg.name ? <div className="bubble-name">{msg.name}</div> : null}
        {msg.text}
        <div className="bubble-meta">
          {msg.time}
          {msg.tag ? ` · ${msg.tag}` : ''}
          {out ? ' ✓' : ''}
        </div>
      </div>
    </div>
  );
}

export default function CustomerInbox({
  business,
  onOpenActivity,
}: {
  business: Business;
  onOpenActivity?: () => void;
}) {
  const t = useT();
  const signedIn = useSignedIn();
  const chat = useChat(business);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const selected = chat.selected;
  const agent = business.team.find((m) => m.n === selected) ?? null;
  const controlling = selected ? chat.controllerOf(selected) : 'ai';
  const messages = selected ? chat.conversation(selected) : [];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, chat.typing, selected]);

  /* The threads below are hand-written demonstrations — named
     customers, invented messages, an owner who can "take over" and
     reply to them. That is the point of the anonymous demo and a lie
     to anyone signed in, and the worst-shaped one in the app: a real
     owner could type an answer to Farid believing it reached him.

     Real customer messages arrive through a connected channel and are
     recorded as runs, so Activity is where they are. Until this screen
     reads them, it says so. */
  if (signedIn) {
    return (
      <Card className="items-center gap-1 py-10 text-center">
        <p className="text-sm">{t('inbox.none')}</p>
        <p className="max-w-[46ch] text-[13px] text-text-secondary">{t('inbox.none.desc')}</p>
        {onOpenActivity ? (
          <Button className="mt-3" onClick={onOpenActivity}>
            {t('inbox.openActivity')}
          </Button>
        ) : null}
      </Card>
    );
  }

  function submit() {
    if (!selected || controlling !== 'you') return;
    chat.send(selected, draft);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ---- Conversation list ---- */}
        <div className={`flex min-w-0 flex-col gap-2 ${selected ? 'hidden lg:flex' : 'flex'}`}>
          <Input
            value={chat.query}
            onChange={(e) => chat.setQuery(e.target.value)}
            placeholder={t('chat.search')}
            aria-label={t('chat.search')}
            className="w-full text-[13px]"
          />
          {chat.visibleAgents.length ? (
            chat.visibleAgents.map((m) => (
              <button
                key={m.n}
                type="button"
                onClick={() => chat.open(m.n)}
                className={`conv ${selected === m.n ? 'conv-active' : ''}`}
              >
                <Avatar emoji={m.e} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{m.n}</span>
                    <span className="hidden shrink-0 font-mono text-[10px] text-text-muted sm:inline">
                      {m.ch}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] text-text-secondary">
                      {chat.preview(m.n) || '—'}
                    </span>
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-[13px] text-text-muted">
              No conversations match “{chat.query}”.
            </p>
          )}
        </div>

        {/* ---- Thread ---- */}
        <div
          className={`card min-h-[360px] min-w-0 gap-0 p-0 sm:min-h-[460px] ${selected ? 'flex' : 'hidden lg:flex'}`}
        >
          {!selected || !agent ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <Icon name="chat" size={34} weight="duotone" className="text-text-muted" />
              <p className="max-w-[34ch] text-[13px] text-text-secondary">
                Pick a conversation to see what the agent has been doing — like opening a chat
                with a member of staff.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-rail px-4 py-3">
                <button
                  type="button"
                  onClick={chat.close}
                  className="nav-link px-1 lg:hidden"
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <Avatar>{agent.e}</Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{agent.n}</span>
                  <span className="text-[10px] text-text-muted">{agent.ch}</span>
                </div>
              </div>

              {/* Who is driving this conversation */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rail px-4 py-2.5">
                <span className="text-[12px] text-text-secondary">
                  {controlling === 'you' ? (
                    <>
                      <b className="text-text">You have control</b> — replies send as your
                      business.
                    </>
                  ) : (
                    <>
                      <b className="text-text">{agent.n}</b> is handling this — 24/7, in your
                      voice.
                    </>
                  )}
                </span>
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() =>
                    controlling === 'you' ? chat.handBack(agent.n) : chat.takeOver(agent.n)
                  }
                >
                  {controlling === 'you' ? 'Hand back to AI →' : 'Take over →'}
                </Button>
              </div>

              <div ref={scroller} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {messages.map((m, i) => (
                  <Bubble key={i} msg={m} />
                ))}
                {chat.typing === selected ? (
                  <div className="flex justify-start">
                    <div className="bubble bubble-in">
                      <span className="typing" aria-label="Agent is typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {controlling === 'you' && templatesFor(agent.n).length > 0 ? (
                <div className="flex flex-wrap gap-2 border-t border-rail px-4 pt-3">
                  {templatesFor(agent.n).map((tx) => (
                    <button
                      key={tx}
                      type="button"
                      onClick={() => setDraft(tx)}
                      className="chip hover:border-brand-line"
                    >
                      {tx}
                    </button>
                  ))}
                </div>
              ) : null}

              <form
                className="flex items-center gap-2 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={controlling !== 'you'}
                  placeholder={
                    controlling === 'you' ? t('chat.reply') : t('chat.takeover')
                  }
                  aria-label={t('chat.reply')}
                  className="flex-1 text-[13px]"
                />
                <Button type="submit" disabled={controlling !== 'you' || !draft.trim()}>
                  {t('chat.send')}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
