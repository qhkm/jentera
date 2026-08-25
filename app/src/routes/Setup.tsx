/* ============================================================
   Setup. A scripted sequence: three steps run themselves, two
   wait for the user to connect a channel.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Shell } from '@/components/Shell';
import { Button, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useMutate } from '@/lib/repo';
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

  function finish() {
    void mutate((r) => r.setSetupDone(true));
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
