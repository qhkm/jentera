import { useEffect } from 'react';
import {
  ArrowRight,
  BracketsCurly,
  CheckCircle,
  Cloud,
  Database,
  Lightning,
  LinkSimple,
  Pulse,
  Stack,
  TerminalWindow,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { useScrollReveal } from '@/hooks/useScrollReveal';

const EARLY_ACCESS =
  'mailto:hello@kitakodventures.com?subject=Jentera%20Connect%20early%20access';

const CONNECT_NAV = [
  { href: '/', label: 'Compute' },
  { href: '#how', label: 'How it works' },
  { href: '#platform', label: 'Platform' },
  { href: '#focus', label: 'Initial focus' },
] as const;

const CAPABILITIES: Array<{
  icon: PhosphorIcon;
  title: string;
  body: string;
  detail: string;
}> = [
  {
    icon: LinkSimple,
    title: 'Embedded account linking',
    body: 'Connect each customer to the software they already use without building a separate authorization flow for every provider.',
    detail: 'OAuth · API keys · scoped credentials',
  },
  {
    icon: Database,
    title: 'Canonical business models',
    body: 'Work with one model for customers, invoices, payments, employees, and other business objects across supported systems.',
    detail: 'Normalized fields · provider extensions',
  },
  {
    icon: Lightning,
    title: 'Agent-native actions',
    body: 'Let agents discover and execute stable business capabilities instead of reasoning over hundreds of provider-specific endpoints.',
    detail: 'API · SDK · MCP',
  },
  {
    icon: Pulse,
    title: 'Sync and operational health',
    body: 'Keep data fresh and connections healthy through webhooks, reconciliation, retries, and provider-aware rate limits.',
    detail: 'Webhooks · polling · observability',
  },
];

const FLOW = [
  ['Link', 'Authorize a business account once.'],
  ['Normalize', 'Map each provider into common models.'],
  ['Read / write', 'Use one contract for queries and mutations.'],
  ['Sync', 'Keep state fresh across changing systems.'],
  ['Act', 'Expose safe tools that agents can invoke.'],
  ['Sustain', 'Maintain credentials, schemas, and health.'],
] as const;

const PROVIDER_GROUPS = [
  {
    category: 'Accounting',
    names: ['SQL Account', 'AutoCount', 'Bukku'],
  },
  {
    category: 'Compliance',
    names: ['MyInvois'],
  },
  {
    category: 'Business operations',
    names: ['Payroll', 'Commerce', 'Messaging'],
  },
] as const;

function Eyebrow({ children }: { children: string }) {
  return (
    <span className="lp-eyebrow">
      <span className="lp-dot" />
      {children}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="heading-shine text-balance font-pixel text-3xl leading-[1.08] tracking-tight md:text-5xl">
        {title}
      </h2>
      <p className="max-w-2xl text-sm leading-relaxed text-text-secondary md:text-base">
        {body}
      </p>
    </div>
  );
}

function AgentPath({ icon: Glyph, title, body }: { icon: PhosphorIcon; title: string; body: string }) {
  return (
    <div className="flex min-h-44 flex-col justify-between gap-8 border border-rail bg-bg-card p-6 md:p-8">
      <Glyph size={25} weight="duotone" className="text-brand" aria-hidden="true" />
      <div>
        <p className="font-pixel text-xl">{title}</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">{body}</p>
      </div>
    </div>
  );
}

export default function Connect() {
  useScrollReveal();

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;

    document.title = 'Jentera Connect — One interface for Southeast Asian business software';
    if (description) {
      description.content =
        'Connect any AI agent to the software Southeast Asian businesses run on through one secure, normalized interface.';
    }

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-text">
      <LandingHeader
        navLinks={CONNECT_NAV}
        primaryAction={{ href: EARLY_ACCESS, label: 'Request access' }}
        showSignIn={false}
      />

      <main id="main-content" className="w-full max-w-full overflow-x-clip">
        <section className="connect-grid connect-glow relative border-b border-rail">
          <div className="mx-auto grid min-h-[calc(100svh-4rem)] min-w-0 w-full max-w-[1250px] items-center gap-12 px-6 py-16 md:px-12 md:py-24 lg:grid-cols-[1.02fr_.98fr]">
            <div className="relative z-10 flex min-w-0 flex-col items-start gap-6">
              <Eyebrow>Jentera Connect · Product direction</Eyebrow>
              <h1
                aria-label="Connect any AI agent to Southeast Asia."
                className="max-w-4xl text-balance font-pixel text-[clamp(2.5rem,7vw,5.5rem)] leading-[.98] tracking-[-0.045em]"
              >
                <span className="heading-shine-bright">Connect any AI agent</span>
                <br />
                <span className="text-brand">to Southeast Asia.</span>
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-text-secondary md:text-lg">
                One secure interface for agents to read, write, and act across the software
                Southeast Asian businesses already run on.
              </p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <a href={EARLY_ACCESS} className="btn btn-primary w-full sm:w-auto">
                  Request early access
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
                <a href="#how" className="btn btn-outline w-full sm:w-auto">
                  See how it works
                </a>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">
                Malaysia first · Built for agents anywhere
              </p>
            </div>

            <div className="connect-terminal relative min-w-0 max-w-full overflow-hidden border border-rail bg-[#171717]/95">
              <div className="flex items-center justify-between border-b border-rail px-4 py-3">
                <div className="flex items-center gap-2" aria-hidden="true">
                  <span className="size-2 rounded-full bg-text-muted/35" />
                  <span className="size-2 rounded-full bg-text-muted/35" />
                  <span className="size-2 rounded-full bg-brand" />
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[.18em] text-text-muted">
                  unified business interface
                </span>
              </div>

              <div className="grid min-w-0 gap-px bg-rail p-px sm:grid-cols-[1fr_auto_1fr]">
                <div className="flex flex-col gap-3 bg-[#171717] p-5">
                  <span className="font-mono text-[9px] uppercase tracking-[.16em] text-text-muted">
                    Any agent
                  </span>
                  {['Claude', 'Codex', 'Hermes', 'LangGraph', 'Custom'].map((agent) => (
                    <span key={agent} className="border border-rail px-3 py-2 font-mono text-[11px] text-text-secondary">
                      {agent}
                    </span>
                  ))}
                </div>

                <div className="hidden w-10 items-center justify-center bg-[#171717] sm:flex">
                  <ArrowRight size={16} className="text-brand" aria-hidden="true" />
                </div>

                <div className="flex min-w-0 flex-col bg-[#171717]">
                  <div className="border-b border-brand-line bg-brand-soft p-5">
                    <span className="font-mono text-[9px] uppercase tracking-[.16em] text-brand">
                      Jentera Connect
                    </span>
                    <p className="mt-2 font-pixel text-xl">One contract.</p>
                  </div>
                  <pre className="w-full min-w-0 max-w-full overflow-x-auto p-5 font-mono text-[11px] leading-6 text-text-secondary"><code><span className="connect-code-key">invoice</span>.createDraft({'{'}
  customer: <span className="connect-code-value">'Acme Sdn Bhd'</span>,
  currency: <span className="connect-code-value">'MYR'</span>,
  amount: <span className="connect-code-value">12000</span>
{'}'})

<span className="connect-code-muted">// provider selected per tenant</span>
<span className="connect-code-muted">// policy checked before write</span></code></pre>
                  <div className="mt-auto grid grid-cols-2 border-t border-rail font-mono text-[9px] uppercase tracking-[.12em] text-text-muted">
                    <span className="border-r border-rail px-4 py-3">API · SDK</span>
                    <span className="px-4 py-3">MCP · CLI</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-rail p-4">
                <span className="tag tag-green">scoped</span>
                <span className="tag">normalized</span>
                <span className="tag">auditable</span>
                <span className="tag">runtime-independent</span>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="border-b border-rail">
          <div className="mx-auto w-full max-w-[1250px] px-6 py-16 md:px-12 md:py-24">
            <SectionHeading
              eyebrow="One integration surface"
              title="Build the business connection once."
              body="Provider APIs disagree on authentication, schemas, pagination, errors, and even the meaning of the same business object. Connect absorbs those differences so your product can stay focused on the work."
            />

            <div className="mt-12 grid border-l border-t border-rail md:grid-cols-2">
              {CAPABILITIES.map(({ icon: Glyph, title, body, detail }) => (
                <article key={title} className="connect-signal flex min-h-64 flex-col border-b border-r border-rail p-6 md:p-8">
                  <Glyph size={25} weight="duotone" className="text-brand" aria-hidden="true" />
                  <h3 className="mt-8 font-pixel text-xl md:text-2xl">{title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-text-secondary">{body}</p>
                  <p className="mt-auto pt-8 font-mono text-[9px] uppercase tracking-[.15em] text-text-muted">
                    {detail}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="border-b border-rail bg-[rgb(var(--border-ink)/.018)]">
          <div className="mx-auto w-full max-w-[1250px] px-6 py-16 md:px-12 md:py-24">
            <SectionHeading
              eyebrow="The capability path"
              title="From account access to reliable action."
              body="A unified API is only the beginning. Connect carries each integration from authorization through normalized execution and ongoing provider maintenance."
            />

            <div className="mt-12 grid border-l border-t border-rail [counter-reset:connect-step] sm:grid-cols-2 lg:grid-cols-3">
              {FLOW.map(([title, body]) => (
                <article key={title} className="connect-flow-step min-h-48 border-b border-r border-rail p-6 md:p-8">
                  <h3 className="font-pixel text-xl">{title}</h3>
                  <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-secondary">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-rail">
          <div className="mx-auto grid w-full max-w-[1250px] gap-12 px-6 py-16 md:px-12 md:py-24 lg:grid-cols-[.8fr_1.2fr]">
            <SectionHeading
              eyebrow="Runtime-independent"
              title="Your agent can run anywhere."
              body="Connect is a standalone Jentera product. Use it from Jentera Compute or bring the runtime, model, and framework your team already operates."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <AgentPath
                icon={Cloud}
                title="Run on Jentera"
                body="Combine persistent agent computers with Connect and the shared Control layer."
              />
              <AgentPath
                icon={TerminalWindow}
                title="Run anywhere else"
                body="Use the same business capabilities from your own cloud, agent framework, or SaaS product."
              />
              <div className="sm:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-3 border border-brand-line bg-brand-soft p-5 font-mono text-[10px] uppercase tracking-[.13em] text-text-secondary">
                <span className="text-brand">One connector core</span>
                <span>API</span>
                <span>SDK</span>
                <span>MCP</span>
                <span>CLI</span>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-rail">
          <div className="mx-auto grid w-full max-w-[1250px] gap-12 px-6 py-16 md:px-12 md:py-24 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <SectionHeading
                eyebrow="Built for real operations"
                title="More than field mapping."
                body="Southeast Asian businesses operate through local documents, tax systems, approval practices, and software that global integration catalogues often treat as edge cases. For Jentera, they are the starting point."
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  'Local accounting systems',
                  'E-invoicing and tax lifecycles',
                  'Multilingual business data',
                  'Approval-aware agent actions',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 border border-rail p-4 text-sm text-text-secondary">
                    <CheckCircle size={18} weight="duotone" className="shrink-0 text-brand" aria-hidden="true" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-rail bg-bg-card">
              <div className="flex items-center justify-between border-b border-rail px-5 py-4">
                <span className="font-mono text-[9px] uppercase tracking-[.16em] text-text-muted">
                  A regional business lifecycle
                </span>
                <Stack size={18} className="text-brand" aria-hidden="true" />
              </div>
              <div className="p-5 md:p-8">
                {['Quotation accepted', 'Invoice drafted', 'Owner approval', 'E-invoice submitted', 'Customer delivery', 'Payment reconciled'].map((step, index, all) => (
                  <div key={step} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className={`flex size-8 items-center justify-center border font-mono text-[10px] ${index === 2 ? 'border-brand-line bg-brand-soft text-brand' : 'border-rail text-text-muted'}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {index < all.length - 1 ? <span className="h-8 w-px bg-rail" /> : null}
                    </div>
                    <div className="pt-1.5 text-sm text-text-secondary">
                      {step}
                      {index === 2 ? <span className="ml-2 tag tag-green">controlled</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="focus" className="border-b border-rail bg-[rgb(var(--border-ink)/.018)]">
          <div className="mx-auto w-full max-w-[1250px] px-6 py-16 md:px-12 md:py-24">
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <SectionHeading
                eyebrow="Initial focus"
                title="Malaysia first. Southeast Asia next."
                body="The first release will go deep on one valuable workflow and a small number of providers. These are target areas, not a claim of current general availability."
              />
              <span className="tag tag-amber self-start lg:self-auto">In development</span>
            </div>

            <div className="mt-12 grid border-l border-t border-rail md:grid-cols-3">
              {PROVIDER_GROUPS.map((group) => (
                <article key={group.category} className="min-h-64 border-b border-r border-rail p-6 md:p-8">
                  <p className="font-mono text-[9px] uppercase tracking-[.16em] text-brand">{group.category}</p>
                  <div className="mt-8 flex flex-col gap-3">
                    {group.names.map((name) => (
                      <div key={name} className="flex items-center justify-between border-b border-rail pb-3 text-sm text-text-secondary">
                        <span>{name}</span>
                        <span className="font-mono text-[8px] uppercase tracking-[.12em] text-text-muted">target</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-rail">
          <div className="lp-cta-band mx-auto my-16 w-[calc(100%-3rem)] max-w-[1154px] px-6 py-16 md:my-24 md:px-12 md:py-20">
            <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center gap-6 text-center text-black">
              <BracketsCurly size={30} weight="duotone" aria-hidden="true" />
              <h2 className="text-balance font-pixel text-3xl leading-[1.08] tracking-tight md:text-5xl">
                Build once for the systems your customers use.
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-black/70 md:text-base">
                We are speaking with agent builders and Southeast Asian software providers shaping the first Connect integrations.
              </p>
              <a href={EARLY_ACCESS} className="btn border-black bg-black text-white hover:opacity-90">
                Talk to us about Connect
                <ArrowRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <LandingFooter tagline="The interface layer between AI agents and Asian businesses." />
      </main>
    </div>
  );
}
