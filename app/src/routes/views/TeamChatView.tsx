/* ============================================================
   Team Chat — you plus every agent in one space, split into
   channels. Tag @agent and that agent replies.

   #escalations mirrors the Work view automatically; it is not a
   place you post to so much as a place things arrive.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Eyebrow, Input, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useTeamChat, type ChannelId } from '@/hooks/useTeamChat';
import type { Business } from '@/lib/types';

export default function TeamChatView({
  business,
  workDone,
}: {
  business: Business;
  workDone: (i: number) => boolean;
}) {
  const t = useT();
  const team = useTeamChat(business, workDone);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [team.messages.length, team.typing, team.selected]);

  const meta = team.meta[team.selected];

  function submit() {
    team.send(draft);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.team')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.team.desc')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* ---- Channels ---- */}
        <div className="flex flex-col gap-3">
          <Eyebrow>
            {team.channels.length} {t('team.channels')}
          </Eyebrow>
          <div className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {team.channels.map((id: ChannelId) => {
              const unread = team.unreadFor(id);
              const active = team.selected === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => team.select(id)}
                  className={`flex shrink-0 items-center justify-between gap-2 rounded-item px-3 py-2 text-[13px] transition-colors lg:shrink ${
                    active
                      ? 'bg-brand-soft text-brand'
                      : 'text-text-secondary hover:bg-[rgb(var(--border-ink)/0.05)] hover:text-text'
                  }`}
                >
                  <span># {team.meta[id].label}</span>
                  {unread > 0 ? <span className="unread">{unread}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="hidden flex-col gap-2 border-t border-rail pt-3 lg:flex">
            <Eyebrow>Members</Eyebrow>
            {business.team.map((m) => (
              <span key={m.n} className="flex items-center gap-2 text-[12px] text-text-secondary">
                <span
                  className="inline-block size-1.5 rounded-full bg-brand"
                  aria-hidden="true"
                />
                {m.n}
              </span>
            ))}
          </div>
        </div>

        {/* ---- Channel thread ---- */}
        <div className="card min-h-[460px] gap-0 p-0">
          <div className="flex flex-col gap-0.5 border-b border-rail px-4 py-3">
            <span className="text-sm font-semibold"># {meta.label}</span>
            <span className="text-[11px] text-text-muted">{meta.desc}</span>
          </div>

          <div ref={scroller} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {team.messages.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-muted">
                Nothing here yet.
              </p>
            ) : (
              team.messages.map((m, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Avatar className="size-7 text-[13px]">{m.from === 'you' ? '🙋' : '🤖'}</Avatar>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold">{m.name}</span>
                      <span className="font-mono text-[9px] tracking-[0.08em] text-text-muted">
                        {m.time}
                      </span>
                      {m.done ? <Tag tone="green">closed</Tag> : null}
                    </span>
                    <span
                      className={`text-[13px] ${m.done ? 'text-text-muted line-through' : 'text-text-secondary'}`}
                    >
                      {m.text}
                    </span>
                  </div>
                </div>
              ))
            )}
            {team.typing ? (
              <div className="flex items-center gap-2.5">
                <Avatar className="size-7 text-[13px]">🤖</Avatar>
                <span className="typing" aria-label="Agent is typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : null}
          </div>

          {meta.tpl.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-t border-rail px-4 pt-3">
              {meta.tpl.map((tx) => (
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
              placeholder={t(`team.ph.${meta.label}`)}
              aria-label={t(`team.ph.${meta.label}`)}
              className="flex-1 px-3 py-2.5 text-[13px]"
            />
            <Button type="submit" disabled={!draft.trim()}>
              {t('chat.send')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
