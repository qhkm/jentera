import { useState, type ReactNode } from 'react';
import { calendarConnectionUrl } from '@/lib/calendar-connection';
import { isNative, openGoogleCalendarSetup } from '@/lib/native';
import { useT } from '@/i18n/I18nProvider';

export function GoogleCalendarConnectionLink({ children, className, newTab = true }: {
  children: ReactNode;
  className?: string;
  newTab?: boolean;
}) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const native = isNative();
  return (
    <>
      <a className={className} href={calendarConnectionUrl()} target={native || newTab ? '_blank' : undefined}
        rel="noopener noreferrer" aria-disabled={opening || undefined}
        onClick={async event => {
          if (!native) return;
          event.preventDefault();
          if (opening) return;
          setError(false);
          setOpening(true);
          try { await openGoogleCalendarSetup(); }
          catch { setError(true); }
          finally { setOpening(false); }
        }}>
        {children}
      </a>
      {error && <p role="alert" className="text-[13px] text-text-secondary">{t('ask.calendarConnect.openFailed')}</p>}
    </>
  );
}
