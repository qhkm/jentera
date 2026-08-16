/* ============================================================
   Onboarding. The whole product hinges on this screen: free text
   in, inferred playbook out. No dropdown of industries, no form.
   ============================================================ */

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Shell } from '@/components/Shell';
import { Button, Card, Eyebrow, Input, Tag } from '@/components/ui';
import { inferPlaybook } from '@/lib/infer';
import { PLAYBOOKS } from '@/lib/data/playbooks';
import { registerBusiness } from '@/lib/business';
import { useT } from '@/i18n/I18nProvider';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';

const EXAMPLES = [
  'Saya buka kedai gunting rambut di Shah Alam',
  'We run a small bakery in Penang',
  'Klinik gigi di Johor Bahru',
];

type Phase = 'ask' | 'confirm';

export default function Onboard() {
  const t = useT();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('ask');
  const [match, setMatch] = useState<{ key: string; score: number } | null>(null);

  function scan(value: string) {
    const input = value.trim();
    if (!input) return;
    setText(input);
    setMatch(inferPlaybook(input));
    setPhase('confirm');
  }

  function activate() {
    registerBusiness(text);
    store.set(KEYS.onboarded, '1');
    navigate('/setup');
  }

  const playbook = match ? PLAYBOOKS[match.key] : null;

  return (
    <Shell suffix="/setup">
      <div className="mx-auto flex max-w-[640px] flex-col gap-8 py-8">
        {phase === 'ask' ? (
          <>
            <div className="flex flex-col gap-3">
              <Eyebrow>{t('ob.step', { n: 1 })}</Eyebrow>
              <h1 className="font-pixel text-3xl tracking-tight">{t('ob.ask.head')}</h1>
              <p className="text-text-secondary">
                {t('ob.ask.body')}
              </p>
            </div>

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                scan(text);
              }}
            >
              <Input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('ob.ask.placeholder')}
                aria-label="Describe your business"
                className="w-full px-4 py-4 text-base"
              />
              <Button type="submit" disabled={!text.trim()} className="py-4 md:py-3">
                {t('ob.ask.cta')}
              </Button>
            </form>

            <div className="flex flex-col gap-3">
              <Eyebrow>{t('ob.ask.examples')}</Eyebrow>
              <div className="flex flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => scan(ex)}
                    className="rounded-item border border-border px-4 py-3 text-left text-[13px] text-text-secondary transition-colors hover:border-border-light hover:text-text"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          playbook && (
            <>
              <div className="flex flex-col gap-3">
                <Eyebrow>{t('ob.step', { n: 2 })}</Eyebrow>
                <h1 className="font-pixel text-3xl tracking-tight">{t('ob.confirm.head')}</h1>
              </div>

              <Card className="gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-3xl" aria-hidden="true">
                    {playbook.icon}
                  </span>
                  <Tag tone={match && match.score > 0 ? 'green' : 'amber'}>
                    {match && match.score > 0 ? t('ob.confirm.matched', { n: match.score }) : t('ob.confirm.guess')}
                  </Tag>
                </div>
                <p className="text-[15px]">{playbook.confirm}</p>
                <div className="flex flex-col gap-1 border-t border-rail pt-3">
                  <span className="text-[13px] text-text-secondary">{playbook.detect}</span>
                  <span className="text-[13px] text-text-muted">
                    {t('ob.confirm.opportunities', { n: playbook.opportunities })}
                  </span>
                </div>
              </Card>

              <div className="flex flex-wrap gap-3">
                <Button onClick={activate} className="py-4 md:py-3">
                  {t('ob.confirm.yes')}
                </Button>
                <Button
                  variant="outline"
                  className="py-4 md:py-3"
                  onClick={() => {
                    setPhase('ask');
                    setMatch(null);
                  }}
                >
                  {t('ob.confirm.no')}
                </Button>
              </div>
            </>
          )
        )}
      </div>
    </Shell>
  );
}
