/* ============================================================
   Your Business — everything AISAR inferred, in one place.
   Correcting the name or location here updates every view,
   because they all derive from the same resolved business.
   ============================================================ */

import { useState } from 'react';
import { Button, Card, Eyebrow, Input, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useToast } from '@/components/Toast';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';
import type { Business, Tone } from '@/lib/types';
import type { PlaybookFunc } from '@/lib/types';

const CHANNELS = ['WhatsApp', 'Instagram', 'Email', 'Phone'];

function funcTone(colour: string): Tone {
  return colour === 'green' || colour === 'amber' || colour === 'red' ? colour : 'neutral';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-rail py-2.5 last:border-b-0">
      <Eyebrow className="shrink-0">{label}</Eyebrow>
      <span className="text-right text-[13px] text-text-secondary">{value || '—'}</span>
    </div>
  );
}

export default function BusinessView({
  business,
  connections,
  onChange,
}: {
  business: Business;
  connections: string[];
  onChange: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState(business.name);
  const [loc, setLoc] = useState(business.loc);

  const active = business.ch.length ? business.ch : connections;

  function save() {
    store.set(KEYS.bizName, name.trim());
    store.set(KEYS.bizLoc, loc.trim());
    onChange();
    toast('Business profile updated ✓');
  }

  const dirty = name.trim() !== business.name || loc.trim() !== business.loc;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.business')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.business.desc')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Eyebrow>{t('biz.profile')}</Eyebrow>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-muted">Business name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-muted">Location</span>
              <Input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                className="w-full px-3 py-2 text-[13px]"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button className="px-4 py-1.5 text-xs" onClick={save} disabled={!dirty}>
                Save changes
              </Button>
              <span className="text-[11px] text-text-muted">
                {business.icon} {business.type}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Detected</Eyebrow>
          <div className="flex flex-col">
            <Row label={t('biz.website')} value={business.site} />
            <Row label={t('biz.contact')} value={active.join(' · ')} />
            <Row label={t('biz.booking')} value={business.booking} />
            <Row label={t('biz.systems')} value={business.systems} />
          </div>
        </Card>

        <Card>
          <Eyebrow>Channels</Eyebrow>
          <p className="text-[13px] text-text-secondary">{t('conn.focus')}</p>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const on = active.includes(c);
              return (
                <span key={c} className={`chip ${on ? 'chip-green' : 'opacity-50'}`}>
                  {c}
                </span>
              );
            })}
          </div>
        </Card>

        <Card>
          <Eyebrow>What AISAR covers</Eyebrow>
          <div className="flex flex-col gap-2">
            {business.funcs.map((f: PlaybookFunc) => (
              <div key={f[0]} className="flex items-center justify-between gap-3">
                <span className="text-[13px]">{f[0]}</span>
                <Tag tone={funcTone(f[1])}>{f[2]}</Tag>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
