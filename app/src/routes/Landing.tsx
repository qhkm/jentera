/* ============================================================
   Landing page — ported from index.html.

   Section order and copy match the source. The repeated
   "eyebrow / headline / lede / bordered panel grid" shape is one
   component here rather than five near-identical markup blocks.
   ============================================================ */

import { useState } from 'react';
import { Link } from 'react-router';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import {
  BUILT_FOR,
  CLOSING_CTA,
  DEMO_STEPS,
  HERO,
  HOW_IT_WORKS,
  ONBOARDING,
  START_BUSINESS,
  WHAT_IT_RUNS,
  type Section,
} from '@/lib/landing-content';

function Eyebrow({ children }: { children: string }) {
  return (
    <span className="lp-eyebrow">
      <span className="lp-dot" />
      {children}
    </span>
  );
}

/** eyebrow + headline + lede + a bordered grid of panels */
function PanelSection({ section }: { section: Section }) {
  return (
    <section id={section.id} className="flex w-full flex-col border-b border-rail">
      <div className="mx-auto flex w-full max-w-[1250px] flex-col gap-8 px-6 pt-14 md:gap-10 md:px-12 md:pt-16">
        <div className="flex flex-col items-center gap-3 text-center md:gap-4">
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h2 className="heading-shine text-balance text-center font-pixel text-2xl font-normal leading-[1.08] tracking-tight md:text-4xl lg:text-5xl lg:leading-[1.05]">
            {section.title}
          </h2>
          <p className="max-w-lg text-[13px] leading-relaxed text-text-secondary md:text-sm">
            {section.lede}
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1250px] overflow-hidden">
        <div className={`grid grid-cols-1 border-t border-rail ${section.columns}`}>
          {section.panels.map((p) => (
            <article
              key={p.title}
              className="flex h-full flex-col gap-5 border-b border-rail px-6 py-8 transition-colors duration-300 hover:bg-[rgb(var(--border-ink)/0.04)] md:px-8 md:py-9"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {p.eyebrow}
              </span>
              <h3 className="font-pixel text-lg tracking-tight md:text-xl">{p.title}</h3>
              <p className="max-w-md text-[13px] leading-relaxed text-text-secondary md:text-sm">
                {p.body}
              </p>
              {p.tags?.length ? (
                <div className="flex flex-wrap gap-2">
                  {p.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function OnboardingDemo() {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');

  function activate() {
    setState('working');
    window.setTimeout(() => setState('done'), 900);
  }

  return (
    <section id={ONBOARDING.id} className="flex w-full flex-col border-b border-rail">
      <div className="mx-auto flex w-full max-w-[1250px] flex-col gap-8 px-6 pt-14 md:gap-10 md:px-12 md:pt-16">
        <div className="flex flex-col items-center gap-3 text-center md:gap-4">
          <Eyebrow>{ONBOARDING.eyebrow}</Eyebrow>
          <h2 className="heading-shine text-center font-pixel text-2xl font-normal leading-[1.08] tracking-tight md:text-4xl lg:text-5xl lg:leading-[1.05]">
            {ONBOARDING.title}
          </h2>
          <p className="max-w-lg text-[13px] leading-relaxed text-text-secondary md:text-sm">
            {ONBOARDING.lede}
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1250px] overflow-hidden">
        <div className="grid grid-cols-1 border-t border-rail lg:grid-cols-2">
          {/* ---- Terminal ---- */}
          <div className="flex flex-col gap-4 border-b border-rail px-6 py-10 md:px-9 lg:border-b-0 lg:border-r">
            <div className="rounded-card border border-[rgb(var(--border-ink)/0.12)] bg-[rgb(var(--border-ink)/0.02)] backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-rail px-4 py-3 md:px-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  onboarding
                </span>
                <span className="tag">~4 steps</span>
              </div>

              <div className="as-chat flex flex-col gap-3 p-4 font-mono text-[11px] leading-relaxed text-text-secondary md:p-5 md:text-[12px]">
                {DEMO_STEPS.map((s) => (
                  <div key={s.text} className="kv-chat-step" style={{ animationDelay: `${s.delay}s` }}>
                    <span className={s.who === 'you' ? 'text-brand' : 'text-text-muted'}>
                      {s.who}&gt;
                    </span>{' '}
                    <span className={s.typing ? 'kv-chat-typing' : undefined}>{s.text}</span>
                  </div>
                ))}

                <div className="kv-chat-step" style={{ animationDelay: '5.4s' }}>
                  <div className="mt-1 rounded-item border border-[rgb(var(--border-ink)/0.12)] bg-[rgb(var(--border-ink)/0.04)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-pixel text-xs text-text">{ONBOARDING.cardTitle}</span>
                      <span className="tag tag-green">ready</span>
                    </div>
                    <div className="mt-2 text-text-secondary">{ONBOARDING.cardHandles}</div>
                    <div className="mt-2 text-text-muted">{ONBOARDING.cardNeeds}</div>
                    <button
                      type="button"
                      onClick={activate}
                      disabled={state !== 'idle'}
                      className={`as-reco-btn mt-3 w-full rounded-item px-3 py-2 text-[10px] uppercase tracking-widest ${
                        state === 'done' ? 'opacity-60' : ''
                      }`}
                    >
                      {state === 'idle'
                        ? ONBOARDING.activate
                        : state === 'working'
                          ? ONBOARDING.activating
                          : ONBOARDING.activated}
                    </button>
                  </div>
                </div>

                {state === 'done' ? (
                  <div className="kv-chat-step" style={{ animationDelay: '.3s' }}>
                    <span className="text-text-muted">jentera&gt;</span>{' '}
                    <span className="text-brand">Customer Assistant is live.</span> It&rsquo;s
                    already answering WhatsApp. Want me to also take over reservations?
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* ---- Explanation ---- */}
          <div className="flex flex-col justify-center gap-5 px-6 py-10 md:px-9">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {ONBOARDING.asideEyebrow}
            </span>
            <h3 className="font-pixel text-2xl leading-[1.08] tracking-tight md:text-3xl">
              {ONBOARDING.asideTitle}
            </h3>
            <ul className="flex flex-col gap-3 text-[13px] leading-relaxed text-text-secondary md:text-sm">
              {ONBOARDING.asidePoints.map((point) => (
                <li key={point}>
                  <span className="text-brand">✓</span> {point}
                </li>
              ))}
            </ul>
            <p className="text-[13px] leading-relaxed text-text-secondary md:text-sm">
              {ONBOARDING.asideBody}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  useScrollReveal();

  return (
    <div className="min-h-dvh bg-bg text-text">
      <LandingHeader />

      <main id="main-content" className="w-full max-w-full overflow-x-clip">
        {/* ---- Hero ---- */}
        {/* No min-height. The upstream markup carries min-h-[calc(100svh-4rem)]
            but that class was never generated in its prebuilt CSS, so the live
            hero has always been content-height — 518px on mobile, 535px on
            desktop. Reproducing the class faithfully made the hero 780px and
            pushed everything into the middle of the screen. */}
        <section className="relative z-[1] flex w-full flex-col overflow-hidden border-b border-rail">
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
            <div className="kv-particles" />
            <div className="kv-blob kv-blob-1" />
            <div className="kv-blob kv-blob-2" />
            <div className="kv-blob kv-blob-3" />
            <div className="absolute inset-x-0 top-0 h-[16%] bg-gradient-to-b from-bg via-bg/35 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-[20%] bg-gradient-to-t from-bg via-bg/40 to-transparent" />
            <div className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-bg/85 to-transparent md:w-10" />
            <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg/85 to-transparent md:w-10" />
          </div>

          <div className="relative z-30 mx-auto flex w-full max-w-[1250px] flex-1 flex-col justify-center gap-4 px-6 py-8 md:gap-8 md:px-12 md:py-14">
            <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 text-center md:gap-5">
              {/* The mobile size is fluid rather than fixed because the line
                  break after the comma is hard-coded, which caps how large the
                  type can go: "without the busywork." is 9.84px wide per 1px of
                  font-size, so it fills the content box (100vw - 3rem) at
                  roughly 9.9vw. The calc lands that line at ~97% of the
                  available width at every phone size — 26.9px at 320, 33.7px at
                  390, 37.6px at 430 — instead of one fixed value that is too
                  small on a Pro Max and overflows on an SE. */}
              <h1 className="max-w-5xl font-pixel text-[clamp(1.65rem,calc(9.8vw-4.5px),2.35rem)] leading-[1.1] tracking-tight sm:text-4xl md:text-[3.5rem] lg:text-[4.5rem] xl:text-[5rem] lg:leading-[1.05]">
                <span className="heading-shine-bright">
                  {HERO.headline[0]}
                  <br />
                  {HERO.headline[1]}
                </span>
              </h1>
              <p className="heading-shine-dim max-w-2xl text-base leading-snug sm:text-lg md:text-xl md:leading-normal">
                {HERO.promise}
              </p>
              <p className="max-w-xl text-[13px] leading-relaxed text-text-secondary md:text-sm">
                {HERO.detail}
              </p>

              <div className="flex w-full max-w-full items-center justify-center gap-2 overflow-x-auto font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted sm:max-w-none">
                <span className="text-brand">✓</span>
                <span className="whitespace-nowrap">{HERO.ticker}</span>
                <span className="kv-cursor" aria-hidden="true" />
              </div>

              <div className="flex w-full max-w-md flex-col justify-center gap-4 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <Link
                  to="/onboard"
                  className="btn btn-primary w-full justify-center px-6 py-4 text-sm sm:w-auto sm:py-3"
                >
                  {HERO.ctaPrimary}
                </Link>
                <a
                  href="#onboarding"
                  className="btn btn-outline w-full justify-center px-6 py-4 text-sm sm:w-auto sm:py-3"
                >
                  {HERO.ctaSecondary}
                </a>
              </div>

              <div className="mt-2 flex flex-row items-start gap-6 sm:gap-8">
                {HERO.stats.map((s) => (
                  <div key={s.label} className="flex flex-col items-center gap-1 sm:items-start">
                    <span className="font-pixel text-3xl text-text md:text-4xl">{s.value}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <PanelSection section={BUILT_FOR} />
        <PanelSection section={HOW_IT_WORKS} />
        <PanelSection section={WHAT_IT_RUNS} />
        <OnboardingDemo />
        <PanelSection section={START_BUSINESS} />

        {/* ---- Closing CTA ---- */}
        <section className="flex w-full flex-col border-b border-rail">
          <div className="lp-cta-band mx-auto mt-14 w-full max-w-[1250px] overflow-hidden px-6 py-16 md:px-12 md:py-20">
            <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
              <h2 className="font-pixel text-2xl font-normal leading-[1.08] tracking-tight text-black md:text-4xl lg:text-5xl">
                {CLOSING_CTA.headline[0]}
                <br />
                {CLOSING_CTA.headline[1]}
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-black/75">{CLOSING_CTA.body}</p>
              <Link
                to="/onboard"
                className="btn w-full justify-center border-black bg-black px-6 py-3 text-sm text-white hover:opacity-90 sm:w-auto"
              >
                {CLOSING_CTA.cta}
              </Link>
            </div>
          </div>
        </section>

        <LandingFooter />
      </main>
    </div>
  );
}
