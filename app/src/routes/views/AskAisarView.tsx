/* ============================================================
   Ask AISAR — two tabs, deliberately not two chat products.

   · Assistant  — the owner asks or instructs; answers come from
                  live state, not a transcript.
   · Customer inbox — the per-agent customer conversations, which
                  used to be a competing top-level "Chat" view.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { ASK_PROMPTS, useAsk } from '@/hooks/useAsk';
import { useIsCompact } from '@/hooks/useMediaQuery';
import CustomerInbox from './CustomerInbox';
import type { Business } from '@/lib/types';

type Tab = 'assistant' | 'conversations';

export default function AskAisarView({
  business,
  handled,
  needs,
}: {
  business: Business;
  handled: number;
  needs: number;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('assistant');
  /* CSS cannot shorten placeholder text, and the full string clips
     mid-word in the narrower mobile composer. */
  const compact = useIsCompact();
  const [draft, setDraft] = useState('');
  const ask = useAsk(business, { handled, needs }, t);
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [ask.messages.length]);

  function submit(text?: string) {
    const body = (text ?? draft).trim();
    if (!body) return;
    ask.send(body);
    setDraft('');
    if (composer.current) composer.current.style.height = 'auto';
    composer.current?.focus();
  }

  const TABS: { id: Tab; labelKey: string }[] = [
    { id: 'assistant', labelKey: 'ask.tab' },
    { id: 'conversations', labelKey: 'ask.tab.conversations' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.chat')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.chat.desc')}</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-rail" role="tablist" aria-label={t('view.chat')}>
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors sm:px-4 ${
                active
                  ? 'border-brand text-brand'
                  : 'border-transparent text-text-secondary hover:text-text'
              }`}
            >
              {t(item.labelKey)}
              {/* Status tag is a nice-to-have; at 390px it doubled the tab
                  width and forced both labels to wrap. */}
              {item.id === 'conversations' ? (
                <Tag tone="green" className="ml-2 hidden sm:inline-flex">
                  {t('ask.inbox.live')}
                </Tag>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === 'assistant' ? (
        <Card className="min-h-[360px] gap-0 p-0 sm:min-h-[440px]">
          <div ref={thread} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
            {!ask.hasHistory ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="text-3xl" aria-hidden="true">
                  ✨
                </span>
                <h2 className="font-pixel text-lg tracking-tight">{t('ask.empty.title')}</h2>
                <p className="max-w-[46ch] text-[13px] text-text-secondary">{t('ask.welcome')}</p>
              </div>
            ) : (
              ask.messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 ${m.from === 'you' ? 'flex-row-reverse' : ''}`}
                >
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-avatar border border-brand-line bg-brand-soft font-mono text-[10px] text-brand"
                    aria-hidden="true"
                  >
                    {m.from === 'you' ? t('ask.you').charAt(0).toUpperCase() : 'AI'}
                  </span>
                  <div className={`bubble ${m.from === 'you' ? 'bubble-out' : 'bubble-in'}`}>
                    {m.text}
                    <div className="bubble-meta">
                      {m.from === 'you' ? t('ask.you') : 'AISAR'} · {t('ask.now')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Prompt chips */}
          <div className="flex gap-2 overflow-x-auto border-t border-rail px-5 pt-3 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
            {ASK_PROMPTS.map((key) => (
              <button
                key={key}
                type="button"
                className="chip shrink-0 hover:border-brand-line"
                onClick={() => submit(t(`ask.prompt.${key}`))}
              >
                {t(`ask.prompt.${key}`)}
              </button>
            ))}
          </div>

          <form
            className="flex items-end gap-2 p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={composer}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={compact ? t('ask.placeholder.short') : t('ask.placeholder')}
              aria-label={t('ask.placeholder')}
              className="input max-h-[120px] w-full min-w-0 flex-1 resize-none px-3"
            />
            <Button type="submit" disabled={!draft.trim()} className="shrink-0 px-4 sm:px-6">
              <span className="sm:hidden">{t('chat.send')}</span>
              <span className="hidden sm:inline">{t('ask.send')}</span>
            </Button>
          </form>
          <p className="px-4 pb-4 text-[11px] text-text-muted sm:px-5">{t('ask.hint')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('ask.conversations')}</Eyebrow>
            <p className="max-w-[66ch] text-[13px] text-text-secondary">
              {t('ask.conversations.desc')}
            </p>
          </div>
          <CustomerInbox business={business} />
        </div>
      )}
    </div>
  );
}
