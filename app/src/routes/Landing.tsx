import { Link } from 'react-router';
import { Shell, PageActions } from '@/components/Shell';
import { Button, Card, Eyebrow, Tag } from '@/components/ui';
import { PLAYBOOKS } from '@/lib/data/playbooks';
import { useT } from '@/i18n/I18nProvider';

const SHOWCASE = ['restaurant', 'retail', 'clinic', 'salon', 'gym', 'laundry'] as const;

export default function Landing() {
  const t = useT();

  return (
    <Shell actions={<PageActions />}>
      <div className="flex flex-col gap-16">
        <section className="flex flex-col gap-6 pt-8">
          <Eyebrow>{t('lp.eyebrow')}</Eyebrow>
          <h1 className="max-w-[18ch] font-pixel text-4xl leading-[1.05] tracking-tight text-balance md:text-6xl">
            {t('lp.headline')}
          </h1>
          <p className="max-w-[58ch] text-lg text-text-secondary">{t('lp.lede')}</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/onboard">
              <Button className="px-6 py-4 md:py-3">{t('lp.cta.primary')}</Button>
            </Link>
            <Link to="/app">
              <Button variant="outline" className="px-6 py-4 md:py-3">
                {t('lp.cta.secondary')}
              </Button>
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <Eyebrow>{t('lp.industries', { n: Object.keys(PLAYBOOKS).length })}</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SHOWCASE.map((key) => {
              const p = PLAYBOOKS[key];
              return (
                <Card key={key} className="gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl" aria-hidden="true">
                      {p.icon}
                    </span>
                    <Tag tone="green">{t('lp.potential', { n: p.potential })}</Tag>
                  </div>
                  <h3 className="text-sm font-semibold">{p.type}</h3>
                  <p className="text-[13px] text-text-secondary">{p.detect}</p>
                </Card>
              );
            })}
          </div>
        </section>
      </div>
    </Shell>
  );
}
