/* ============================================================
   Setup. Signed-in owners see control-plane runtime state and the real
   Telegram connector. The anonymous demo keeps the original scripted
   preview because it has no server resources to observe or connect.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Shell } from '@/components/Shell';
import { Button, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useMutate, useRepository } from '@/lib/repo';
import type { RuntimeSummary } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { useConnections } from '@/hooks/useConnections';
import TelegramConnect from '@/routes/views/TelegramConnect';
import { useT } from '@/i18n/I18nProvider';

type Status = 'pending' | 'running' | 'waiting' | 'done';

interface Step {
  id: number;
  label: string;
  done: string;
  /** true when the user has to act */
  manual?: boolean;
}

const STEPS: Step[] = [
  { id: 1, label: 'su.step1', done: 'su.step1.done' },
  { id: 2, label: 'su.step2', done: 'su.step2.done' },
  { id: 3, label: 'su.step3', done: 'su.step3.done' },
  { id: 4, label: 'su.step4', done: 'su.step45.done', manual: true },
  { id: 5, label: 'su.step5', done: 'su.step45.done', manual: true },
];

const AUTO_TIMINGS = [900, 1700, 2600];

export default function Setup() {
  return useSignedIn() ? <LiveSetup /> : <DemoSetup />;
}

/** The real account handoff. Provisioning is idempotently re-signalled when
    this screen mounts, which also recovers the narrow case where onboarding
    committed its durable task but Queue delivery failed before the response. */
function LiveSetup() {
  const t = useT();
  const navigate = useNavigate();
  const repo = useRepository();
  const mutate = useMutate();
  const connections = useConnections();
  const [runtime, setRuntime] = useState<RuntimeSummary | null>(null);
  const [runtimeLoaded, setRuntimeLoaded] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const refreshRuntime = useCallback(async () => {
    try {
      const current = await repo.runtimeStatus();
      setRuntime(current.runtime);
      setRuntimeLoaded(true);
      if (current.runtime?.lastError) setRuntimeError(current.runtime.lastError);
      else if (current.runtime) setRuntimeError(null);
      return current.runtime;
    } catch (error) {
      setRuntimeLoaded(true);
      setRuntimeError(error instanceof Error ? error.message : 'Could not check agent setup.');
      return null;
    }
  }, [repo]);

  const startRuntime = useCallback(async () => {
    setRuntimeError(null);
    try {
      await repo.provisionRuntime();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Could not start agent setup.');
    }
    await refreshRuntime();
  }, [refreshRuntime, repo]);

  useEffect(() => {
    let live = true;
    let timer: number | null = null;
    const poll = async () => {
      const current = await refreshRuntime();
      if (!live) return;
      const settled = current && ['ready', 'cold', 'idle', 'busy'].includes(current.status) &&
        current.observedRelease === current.desiredRelease;
      if (!settled) timer = window.setTimeout(poll, 3000);
    };
    void repo.provisionRuntime()
      .catch((error) => {
        if (live) {
          setRuntimeError(error instanceof Error ? error.message : 'Could not start agent setup.');
        }
      })
      .finally(() => {
        if (live) void poll();
      });
    return () => {
      live = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refreshRuntime, repo]);

  const runtimeReady = Boolean(
    runtime && ['ready', 'cold', 'idle', 'busy'].includes(runtime.status) &&
      runtime.observedRelease === runtime.desiredRelease,
  );
  const connected = (connections.rows ?? []).filter((row) =>
    row.status === 'connected' && (row.connector !== 'telegram' || row.paired === true)).length;
  const completed = 1 + Number(runtimeReady) + Number(connected > 0);

  async function finish() {
    setFinishing(true);
    setFinishError(null);
    try {
      await mutate((r) => r.setSetupDone(true));
      navigate('/app');
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : t('su.live.finishFailed'));
      setFinishing(false);
    }
  }

  const runtimeLabel = !runtimeLoaded
    ? t('su.live.checking')
    : runtimeReady
      ? t('su.live.ready')
      : runtime?.status === 'error' || runtimeError
        ? t('su.live.attention')
        : runtime ? t('su.state.linking') : t('su.state.queued');
  const runtimeStage = t(runtimeStageKey(runtimeLoaded, runtime));

  return (
    <Shell suffix="/setup">
      <div className="mx-auto flex max-w-[720px] flex-col gap-8 py-8">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <Eyebrow>{t('su.eyebrow')}</Eyebrow>
            <Tag tone={runtimeReady ? 'green' : runtimeError ? 'red' : 'amber'}>
              {runtimeReady ? t('su.live.agentReady') : t('su.live.settingUp')}
            </Tag>
          </div>
          <h1 className="font-pixel text-3xl tracking-tight">{t('su.head')}</h1>
          <p className="text-text-secondary">
            {t('su.live.body')}
          </p>
          <Progress value={(completed / 3) * 100} label="Setup progress" />
        </div>

        {!runtimeReady && !runtimeError ? (
          <RuntimePreparing stage={runtimeStage} />
        ) : null}

        <Card className="gap-0 p-0">
          <SetupStatusRow
            label={t('su.live.profile')}
            detail={t('su.live.profileSaved')}
            state={t('su.state.done')}
          />
          <SetupStatusRow
            label={t('su.live.agent')}
            detail={runtimeError ?? (runtimeReady ? t('su.live.verified') : t('su.live.provisioning'))}
            state={runtimeLabel}
            tone={runtimeReady ? 'green' : runtimeError ? 'red' : 'amber'}
          />
          <SetupStatusRow
            label={t('su.live.channel')}
            detail={connected > 0 ? t('su.live.connected', { n: connected }) : t('su.live.connectTelegram')}
            state={connected > 0 ? t('su.state.done') : t('su.state.waiting')}
            tone={connected > 0 ? 'green' : 'neutral'}
            last
          />
        </Card>

        {runtimeError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="flex-1 text-sm text-text-secondary">{runtimeError}</p>
            <Button variant="outline" onClick={() => void startRuntime()}>
              {t('su.live.retry')}
            </Button>
          </div>
        ) : null}

        <TelegramConnect rows={connections.rows} setRows={connections.setRows} />

        <div className="flex flex-col gap-3">
          <Button onClick={() => void finish()} disabled={finishing} className="py-4 md:py-3">
            {finishing ? t('su.live.finishing') : runtimeReady ? t('su.open') : t('su.live.continue')}
          </Button>
          {finishError ? <p role="alert" className="text-sm text-text-secondary">{finishError}</p> : null}
          {!runtimeReady ? (
            <p className="text-[12px] text-text-muted">
              {t('su.live.fallback')}
            </p>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

function runtimeStageKey(loaded: boolean, runtime: RuntimeSummary | null): string {
  if (!loaded) return 'su.live.stage.checking';
  if (!runtime) return 'su.live.stage.queued';
  if (runtime.status === 'provisioning') return 'su.live.stage.provisioning';
  if (runtime.status === 'upgrading' || runtime.status === 'migrating') {
    return 'su.live.stage.installing';
  }
  if (runtime.status === 'waking') return 'su.live.stage.starting';
  if (runtime.observedRelease !== runtime.desiredRelease) return 'su.live.stage.verifying';
  return 'su.live.stage.installing';
}

function RuntimePreparing({ stage }: { stage: string }) {
  const t = useT();
  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="relative overflow-hidden border border-brand-line bg-brand-soft p-5 sm:p-6"
    >
      <div className="absolute inset-x-0 top-0 h-px overflow-hidden bg-brand-line" aria-hidden="true">
        <span className="loading-sweep block h-full w-1/3 bg-brand" />
      </div>
      <div className="flex items-start gap-4 sm:items-center sm:gap-5">
        <div className="relative flex size-14 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="loading-ring absolute inset-0 rounded-full border border-brand-line border-t-brand" />
          <span className="absolute inset-2 border border-brand-line" />
          <span className="font-pixel text-lg text-brand">J</span>
        </div>
        <div className="min-w-0 flex-1">
          <Eyebrow>{t('su.live.loader.eyebrow')}</Eyebrow>
          <h2 className="mt-1 text-lg font-medium text-text">{stage}</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {t('su.live.loader.note')}
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-2 border-t border-brand-line pt-4 text-[12px] text-text-secondary sm:grid-cols-2">
        <span className="flex items-center gap-2">
          <span className="size-1.5 bg-brand" aria-hidden="true" />
          {t('su.live.loader.private')}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-1.5 bg-brand" aria-hidden="true" />
          {t('su.live.loader.continue')}
        </span>
      </div>
    </section>
  );
}

function SetupStatusRow({
  label,
  detail,
  state,
  tone = 'green',
  last = false,
}: {
  label: string;
  detail: string;
  state: string;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-4 ${last ? '' : 'border-b border-rail'}`}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm">{label}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">{detail}</span>
      </div>
      <Tag tone={tone}>{state}</Tag>
    </div>
  );
}

function DemoSetup() {
  const t = useT();
  const navigate = useNavigate();
  const mutate = useMutate();
  const [status, setStatus] = useState<Record<number, Status>>({
    1: 'pending',
    2: 'pending',
    3: 'pending',
    4: 'pending',
    5: 'pending',
  });
  const timers = useRef<number[]>([]);

  useEffect(() => {
    AUTO_TIMINGS.forEach((ms, i) => {
      timers.current.push(
        window.setTimeout(() => setStatus((s) => ({ ...s, [i + 1]: 'done' })), ms),
      );
    });
    timers.current.push(
      window.setTimeout(() => setStatus((s) => ({ ...s, 4: 'waiting', 5: 'waiting' })), 2800),
    );
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  const doneCount = Object.values(status).filter((s) => s === 'done').length;
  const allDone = doneCount === STEPS.length;

  useEffect(() => {
    if (allDone) void mutate((r) => r.setSetupDone(true));
  }, [allDone, mutate]);

  function connect(id: number) {
    setStatus((s) => ({ ...s, [id]: 'running' }));
    timers.current.push(
      window.setTimeout(() => setStatus((s) => ({ ...s, [id]: 'done' })), 1400),
    );
  }

  async function finish() {
    /* Await before navigating. setSetupDone gates the command-centre
       stage, so arriving at /app before it lands shows the wrong one.
       Harmless while writes are synchronous; a race the moment they
       cross a network. */
    try {
      await mutate((r) => r.setSetupDone(true));
    } catch {
      /* The provider surfaces it; still navigate rather than trapping
         the user on a screen whose only action just failed. */
    }
    navigate('/app');
  }

  const waiting = Object.values(status).filter((s) => s === 'waiting').length;

  return (
    <Shell suffix="/setup">
      <div className="mx-auto flex max-w-[640px] flex-col gap-8 py-8">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <Eyebrow>{t('su.eyebrow')}</Eyebrow>
            <Tag tone={allDone ? 'green' : 'neutral'}>
              {allDone
                ? t('su.complete')
                : waiting > 0
                  ? t('su.needyou', { done: doneCount, total: STEPS.length, n: waiting })
                  : t('su.count', { done: doneCount, total: STEPS.length })}
            </Tag>
          </div>
          <h1 className="font-pixel text-3xl tracking-tight">{t('su.head')}</h1>
          <p className="text-text-secondary">
            {allDone
              ? t('su.done')
              : t('su.body')}
          </p>
          <Progress value={(doneCount / STEPS.length) * 100} label="Setup progress" />
        </div>

        <Card className="gap-0 p-0">
          {STEPS.map((step, i) => {
            const s = status[step.id];
            return (
              <div
                key={step.id}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${
                  i < STEPS.length - 1 ? 'border-b border-rail' : ''
                }`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">{t(step.label)}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    {s === 'done'
                      ? t(step.done)
                      : s === 'running'
                        ? t('su.state.linking')
                        : s === 'waiting'
                          ? t('su.state.waiting')
                          : t('su.state.queued')}
                  </span>
                </div>
                {s === 'done' ? (
                  <Tag tone="green">{t('su.state.done')}</Tag>
                ) : step.manual && s === 'waiting' ? (
                  <Button
                    variant="outline"
                    className="px-4 py-1.5 text-xs"
                    onClick={() => connect(step.id)}
                  >
                    {t('su.connect')}
                  </Button>
                ) : s === 'running' ? (
                  <Tag tone="amber">{t('su.state.linking')}</Tag>
                ) : (
                  <Tag>{t('su.state.queued')}</Tag>
                )}
              </div>
            );
          })}
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button onClick={finish} className="py-4 md:py-3">
            {allDone ? t('su.open') : t('su.skip')}
          </Button>
        </div>
      </div>
    </Shell>
  );
}
