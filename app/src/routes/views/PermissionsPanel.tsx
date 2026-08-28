/* ============================================================
   Permissions.

   Not a settings screen that documents behaviour elsewhere —
   callTool reads these, so moving an operation here changes what
   the agent is actually allowed to do.
   ============================================================ */

import { useState } from 'react';
import { Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useToast } from '@/components/Toast';
import { useMutate, useSnapshot } from '@/lib/repo';
import {
  PRIVATE_OPERATIONS,
  getPolicies,
  isCustomised,
  type Operation,
  type Policy,
} from '@/lib/permissions';
import type { Tone } from '@/lib/types';

const LEVELS: { id: Policy; tone: Tone }[] = [
  { id: 'automatic', tone: 'green' },
  { id: 'approval', tone: 'amber' },
  { id: 'blocked', tone: 'red' },
];

export default function PermissionsPanel() {
  const t = useT();
  const toast = useToast();
  const snap = useSnapshot();
  const mutate = useMutate();
  const policies = getPolicies(snap);
  const [saving, setSaving] = useState<Operation | 'reset' | null>(null);

  async function change(op: Operation, next: Policy) {
    setSaving(op);
    try {
      await mutate((r) => r.setPolicy(op, next));
      toast(t('perm.saved'));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('perm.failed'), 'error');
    } finally {
      setSaving(null);
    }
  }

  async function reset() {
    setSaving('reset');
    try {
      await mutate((r) => r.resetPolicies());
      toast(t('perm.reset'));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('perm.failed'), 'error');
    } finally {
      setSaving(null);
    }
  }

  const customised = PRIVATE_OPERATIONS.filter((op) => isCustomised(snap, op)).length;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>{t('perm.title')}</Eyebrow>
        <p className="max-w-[66ch] text-[13px] text-text-secondary">{t('perm.desc')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="green">{t('perm.recommended')}</Tag>
        <span className="text-[12px] text-text-secondary">{t('perm.recommended.desc')}</span>
      </div>

      <details className="rounded-card border border-border p-4" open={customised > 0 || undefined}>
        <summary className="cursor-pointer text-[13px] font-semibold text-text">
          {t('perm.customise')}
        </summary>

        {/* What the three levels mean, before the controls that use them. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {LEVELS.map((lvl) => (
            <Card key={lvl.id} className="gap-2">
              <Tag tone={lvl.tone}>{t(`perm.${lvl.id}`)}</Tag>
              <p className="text-[12px] leading-relaxed text-text-secondary">
                {t(`perm.${lvl.id}.desc`)}
              </p>
            </Card>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2">
        {PRIVATE_OPERATIONS.map((op) => {
          const current = policies[op];
          return (
            <Card key={op} className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  {t(`perm.op.${op}`)}
                  {isCustomised(snap, op) ? <Tag>{t('perm.changed')}</Tag> : null}
                </span>
                <span className="text-[11px] leading-relaxed text-text-muted">
                  {t(`perm.op.${op}.desc`)}
                </span>
              </div>

              <div
                className="flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]"
                role="radiogroup"
                aria-label={t(`perm.op.${op}`)}
              >
                {LEVELS.map((lvl) => {
                  const on = current === lvl.id;
                  return (
                    <button
                      key={lvl.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={saving !== null}
                      onClick={() => void change(op, lvl.id)}
                      className={`shrink-0 whitespace-nowrap rounded-item border px-3 py-1.5 text-[11px] transition-colors ${
                        on
                          ? 'border-brand-line bg-brand-soft text-brand'
                          : 'border-border text-text-secondary hover:border-border-light hover:text-text'
                      }`}
                    >
                      {t(`perm.${lvl.id}`)}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
        </div>

        {customised > 0 ? (
          <div className="mt-4">
            <Button
              variant="outline"
              className="px-4 py-1.5 text-xs"
              onClick={() => void reset()}
              disabled={saving !== null}
            >
              {saving === 'reset' ? t('perm.saving') : t('perm.reset')}
            </Button>
          </div>
        ) : null}
      </details>

      <Card className="gap-2 border-dashed">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>{t('perm.future.title')}</Eyebrow>
          <Tag>{t('perm.future.tag')}</Tag>
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          {t('perm.future.desc')}
        </p>
      </Card>

    </section>
  );
}
