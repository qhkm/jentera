import { ArrowUpRight, Globe } from '@phosphor-icons/react';
import { useT } from '@/i18n/I18nProvider';
import type { BrowserHandoffReason } from '@/lib/browser-handoff';

export function BrowserHandoffCard({ reason, onOpen }: { reason: BrowserHandoffReason; onOpen: () => void }) {
  const t = useT();
  const title = t(`ask.browserHandoff.title.${reason}`);
  return (
    <section className="card ask-browser-handoff" aria-label={title}>
      <header>
        <span className="ask-browser-handoff-icon" aria-hidden="true"><Globe size={22} weight="duotone" /></span>
        <div>
          <p>{t('browser.title')}</p>
          <h3>{title}</h3>
        </div>
      </header>
      <p className="ask-browser-handoff-detail">{t(`ask.browserHandoff.detail.${reason}`)}</p>
      <button type="button" className="btn btn-primary" onClick={onOpen}>
        {t('browser.open')}
        <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      <p className="ask-browser-handoff-note">{t('ask.browserHandoff.handBack')}</p>
      <small>{t('ask.browserHandoff.private')}</small>
    </section>
  );
}
