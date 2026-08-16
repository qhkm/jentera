/* ============================================================
   Chat — one thread per agent, like messaging your staff.
   You can take over any conversation and reply as the business,
   then hand it back to the AI.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Input } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { templatesFor, useChat, type ChatMessage } from '@/hooks/useChat';
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

export default function ChatView({ business }: { business: Business }) {
  const t = useT();
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

  function submit() {
    if (!selected || controlling !== 'you') return;
    chat.send(selected, draft);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.chat')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.chat.desc')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ---- Conversation list ---- */}
        <div className={`flex flex-col gap-2 ${selected ? 'hidden lg:flex' : 'flex'}`}>
          <Input
            value={chat.query}
            onChange={(e) => chat.setQuery(e.target.value)}
            placeholder={`🔍 ${t('chat.search')}`}
            aria-label={t('chat.search')}
            className="w-full px-3 py-2 text-[13px]"
          />
          {chat.visibleAgents.length ? (
            chat.visibleAgents.map((m) => (
              <button
                key={m.n}
                type="button"
                onClick={() => chat.open(m.n)}
                className={`conv ${selected === m.n ? 'conv-active' : ''}`}
              >
                <Avatar>{m.e}</Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{m.n}</span>
                    <span className="shrink-0 font-mono text-[10px] text-text-muted">{m.ch}</span>
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
          className={`card min-h-[460px] gap-0 p-0 ${selected ? 'flex' : 'hidden lg:flex'}`}
        >
          {!selected || !agent ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <span className="text-4xl" aria-hidden="true">
                💬
              </span>
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
                      🙋 <b className="text-text">You have control</b> — replies send as your
                      business.
                    </>
                  ) : (
                    <>
                      🤖 <b className="text-text">{agent.n}</b> is handling this — 24/7, in your
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
                    controlling === 'you' ? t('chat.reply') : `💡 ${t('chat.takeover')}`
                  }
                  aria-label={t('chat.reply')}
                  className="flex-1 px-3 py-2.5 text-[13px]"
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
