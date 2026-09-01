/* ============================================================
   Ask Jentera — the owner's private Business Assistant.

   Customer conversations do not appear until Jentera has a real
   customer-facing runtime and the business connects a supported channel.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { ASK_PROMPTS, useAsk } from "@/hooks/useAsk";
import { useIsCompact } from "@/hooks/useMediaQuery";
import { Icon, DataIcon } from "@/components/Icon";
import { OutcomeReceipt, TypingBubble } from "@/components/WorkSignal";
import { useMentions } from "@/hooks/useMentions";
import { useSignedIn } from "@/lib/repo/gate";
import { useActivity } from "@/hooks/useActivity";
import type { Business } from "@/lib/types";
import type { AskMode } from "@/lib/repo";

export default function AskJenteraView({
  business,
  handled,
  needs,
  firstRun = false,
  onOpenActivity,
  onOpenConnections,
}: {
  business: Business;
  handled: number;
  needs: number;
  firstRun?: boolean;
  onOpenActivity?: () => void;
  onOpenConnections?: () => void;
}) {
  const { t, lang } = useI18n();
  /* CSS cannot shorten placeholder text, and the full string clips
     mid-word in the narrower mobile composer. */
  const compact = useIsCompact();
  const [draft, setDraft] = useState("");
  const activity = useActivity();
  const onAskCompleted = useCallback(
    () => activity.reload(),
    [activity.reload],
  );
  const ask = useAsk(business, { handled, needs }, t, lang, onAskCompleted);
  const signedIn = useSignedIn();
  /* Telegram-style: the chat bar earns its place once the owner can
     hold more than one conversation — either signed in (persists) or
     after starting a second chat. */
  const showSessions = signedIn || ask.sessions.length > 1;
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentions(business.team);

  const stickToBottom = useCallback(() => {
    const el = thread.current;
    if (!el) return;
    // Two frames: one for React's paint, one for the keyboard reflow.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  useEffect(() => {
    stickToBottom();
  }, [
    ask.messages.length,
    ask.messages.at(-1)?.state,
    ask.messages.at(-1)?.text,
    stickToBottom,
  ]);

  /* The keyboard opening changes the thread's height without adding a
     message, so the effect above would not fire. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener("resize", stickToBottom);
    return () => vv.removeEventListener("resize", stickToBottom);
  }, [stickToBottom]);

  function choose(member: (typeof business.team)[number]) {
    const el = composer.current;
    if (!el) return;
    const { value, caret } = mentions.complete(
      el.value,
      el.selectionStart ?? el.value.length,
      member,
    );
    setDraft(value);
    mentions.close();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function submit(text?: string, mode: AskMode = "work") {
    const body = (text ?? draft).trim();
    if (!body) return;
    ask.send(body, mode);
    setDraft("");
    if (composer.current) composer.current.style.height = "auto";
    if (compact) {
      // Dismissing the keyboard hands the screen back to the answer.
      composer.current?.blur();
    } else {
      composer.current?.focus();
    }
    stickToBottom();
  }

  return (
    /* 100dvh minus the sticky header (64px) and the bottom nav (64px).
       dvh rather than vh so mobile browser chrome does not clip it. */
    <div className="chat-shell flex flex-col gap-0 lg:h-auto lg:gap-6">
      <header className="hidden flex-col gap-2 lg:flex">
        <h1 className="font-pixel text-2xl tracking-tight">{t("view.chat")}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">
          {t("view.chat.desc")}
        </p>
      </header>

      <Card className="min-h-0 flex-1 gap-0 rounded-none border-x-0 border-b-0 p-0 lg:min-h-[440px] lg:flex-none lg:rounded-card lg:border">
        {showSessions ? (
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-rail px-4 py-2.5 [scrollbar-width:none] sm:px-5">
            <button
              type="button"
              className="chip shrink-0 gap-1.5 border-dashed hover:border-brand-line"
              onClick={ask.newSession}
            >
              <Icon name="plus" size={12} className="text-brand" />
              <span className="max-sm:hidden">{t("ask.newChat")}</span>
            </button>
            {ask.sessions.map((session) => {
              const active = session.id === ask.activeId;
              return (
                <div
                  key={session.id}
                  className={`flex shrink-0 items-center gap-1 rounded-pill border py-1 pl-3 pr-1.5 transition-colors ${
                    active
                      ? "border-brand bg-brand-soft"
                      : "border-rail bg-bg-card hover:border-border-light"
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    title={session.title || t("ask.chat.untitled")}
                    className="max-w-[10rem] truncate text-[12px] font-medium text-text-secondary hover:text-text"
                    onClick={() => ask.openSession(session.id)}
                  >
                    {session.title || t("ask.chat.untitled")}
                  </button>
                  {ask.sessions.length > 1 ? (
                    <button
                      type="button"
                      aria-label={t("ask.deleteChat")}
                      className="rounded-full p-1 text-text-muted transition-colors hover:bg-border-light hover:text-text"
                      onClick={() => ask.deleteSession(session.id)}
                    >
                      <Icon name="close" size={10} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div
          ref={thread}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5"
        >
          {!ask.hasHistory ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Icon
                name="sparkle"
                size={30}
                weight="duotone"
                className="text-brand"
              />
              <h2 className="font-pixel text-lg tracking-tight">
                {t("ask.empty.title")}
              </h2>
              <p className="max-w-[46ch] text-[13px] text-text-secondary">
                {t(firstRun ? "ask.welcome.first" : "ask.welcome")}
              </p>
              {signedIn &&
              activity.real &&
              activity.data!.counters.connections === 0 ? (
                <div className="mt-2 flex max-w-[34rem] flex-col items-center gap-2 border-t border-rail pt-4">
                  <p className="text-[12px] leading-relaxed text-text-muted">
                    {t("ask.connection.optional")}
                  </p>
                  {onOpenConnections ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-brand hover:underline"
                      onClick={onOpenConnections}
                    >
                      {t("ask.connection.open")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            ask.messages.map((m, i) => {
              const aiWorkDone =
                m.from === "ai" && m.mode === "work" && m.state === "done";
              const aiPending = m.from === "ai" && m.pendingId;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 ${m.from === "you" ? "flex-row-reverse" : ""} ${
                    aiWorkDone ? "w-full" : ""
                  }`}
                >
                  {aiWorkDone ? (
                    <OutcomeReceipt
                      title={t("ask.receipt.title")}
                      outcome={m.text}
                      audience={t("ask.private")}
                      evidence={
                        m.grounded
                          ? m.usedKeys?.length
                            ? t("ask.receipt.facts", { n: m.usedKeys.length })
                            : t("ask.receipt.grounded")
                          : t("ask.receipt.noFacts")
                      }
                      statusLabel={t("ask.receipt.done")}
                      actionLabel={
                        onOpenActivity ? t("ask.receipt.activity") : undefined
                      }
                      onAction={onOpenActivity}
                    />
                  ) : aiPending ? (
                    <>
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-avatar border border-brand-line bg-brand-soft font-mono text-[10px] text-brand"
                        aria-hidden="true"
                      >
                        {m.agent ? (
                          <DataIcon
                            emoji={
                              business.team.find((x) => x.n === m.agent)?.e ??
                              ""
                            }
                            size={15}
                          />
                        ) : (
                          <Icon name="robot" size={15} />
                        )}
                      </span>
                      <TypingBubble label={m.text} />
                    </>
                  ) : (
                    <>
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-avatar border border-brand-line bg-brand-soft font-mono text-[10px] text-brand"
                        aria-hidden="true"
                      >
                        {m.from === "you" ? (
                          <Icon name="owner" size={15} />
                        ) : m.agent ? (
                          <DataIcon
                            emoji={
                              business.team.find((x) => x.n === m.agent)?.e ??
                              ""
                            }
                            size={15}
                          />
                        ) : (
                          <Icon name="robot" size={15} />
                        )}
                      </span>
                      <div
                        className={`bubble ${m.from === "you" ? "bubble-out" : "bubble-in"}`}
                      >
                        <span role={m.failedQuestion ? "alert" : undefined}>
                          {m.text}
                        </span>
                        {m.failedQuestion ? (
                          <button
                            type="button"
                            className="mt-2 block text-[11px] font-semibold text-brand hover:underline"
                            onClick={() =>
                              submit(m.failedQuestion, m.failedMode ?? "work")
                            }
                          >
                            {t("ask.retry")}
                          </button>
                        ) : null}
                        <div className="bubble-meta">
                          {m.from === "you"
                            ? t("ask.you")
                            : (m.agent ?? "Jentera")}{" "}
                          · {t("ask.now")}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Prompt chips */}
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-rail px-4 pt-3 [scrollbar-width:none] sm:px-5 lg:flex-wrap lg:overflow-visible">
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

        <div className="relative">
          {mentions.open ? (
            <ul
              id="mention-list"
              role="listbox"
              aria-label="Tag an agent"
              className="absolute inset-x-4 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-card border border-border-light bg-bg-card p-1 shadow-lg sm:inset-x-5"
            >
              {mentions.matches.map((m, i) => (
                <li key={m.n}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === mentions.active}
                    onMouseEnter={() => mentions.setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(m);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-item px-3 py-2 text-left text-[13px] transition-colors ${
                      i === mentions.active
                        ? "bg-brand-soft text-brand"
                        : "text-text-secondary hover:bg-[rgb(var(--border-ink)/0.05)]"
                    }`}
                  >
                    <DataIcon emoji={m.e} size={15} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-text">
                        {m.n}
                      </span>
                      <span className="truncate text-[11px] text-text-muted">
                        {m.ch}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <form
          className="flex shrink-0 items-end gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
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
              mentions.sync(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onClick={(e) => {
              const el = e.currentTarget;
              mentions.sync(el.value, el.selectionStart ?? el.value.length);
            }}
            onBlur={() => window.setTimeout(mentions.close, 120)}
            onKeyDown={(e) => {
              if (mentions.open) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  mentions.move(1);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  mentions.move(-1);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  choose(mentions.matches[mentions.active]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  mentions.close();
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            role="combobox"
            aria-expanded={mentions.open}
            aria-controls="mention-list"
            aria-autocomplete="list"
            placeholder={
              compact ? t("ask.placeholder.short") : t("ask.placeholder")
            }
            aria-label={t("ask.placeholder")}
            className="input max-h-[120px] w-full min-w-0 flex-1 resize-none"
          />
          <Button
            type="submit"
            disabled={!draft.trim()}
            className="shrink-0 px-4 sm:px-6"
          >
            <span className="sm:hidden">{t("chat.send")}</span>
            <span className="hidden sm:inline">{t("ask.send")}</span>
          </Button>
        </form>
        <p className="hidden px-4 pb-4 text-[11px] text-text-muted sm:px-5 lg:block">
          {t("ask.hint")}
        </p>
      </Card>
    </div>
  );
}
