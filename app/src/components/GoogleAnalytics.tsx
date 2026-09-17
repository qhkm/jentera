import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { isNative } from '@/lib/native';
import {
  ANALYTICS_CHOICE_EVENT, ANALYTICS_CHOICE_KEY, analyticsPrivacyOptOut,
  googleAnalytics, publicAnalyticsPage, readAnalyticsChoice, saveAnalyticsChoice,
  type AnalyticsChoice,
} from '@/lib/google-analytics';
import '@/styles/analytics-choice.css';

function useAnalyticsChoice() {
  const [choice, setChoice] = useState<AnalyticsChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const update = () => { setChoice(readAnalyticsChoice()); setReady(true); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== ANALYTICS_CHOICE_KEY) return;
      if (document.getElementById('jentera-google-tag') && readAnalyticsChoice() !== 'allowed') {
        googleAnalytics.stop();
        location.reload();
      } else update();
    };
    update();
    window.addEventListener(ANALYTICS_CHOICE_EVENT, update);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ANALYTICS_CHOICE_EVENT, update);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const choose = (next: AnalyticsChoice) => { setError(!saveAnalyticsChoice(next)); };
  return { choice, ready, error, choose };
}

/** Shared route observer; SSR and the first hydration render remain identical. */
export function GoogleAnalytics() {
  const route = useLocation();
  const { choice, ready, error, choose } = useAnalyticsChoice();
  const href = typeof location === 'undefined' ? '' : `${location.origin}${route.pathname}${route.search}${route.hash}`;
  const eligible = Boolean(publicAnalyticsPage(href)) && !isNative() && !analyticsPrivacyOptOut();
  useEffect(() => {
    if (ready) googleAnalytics.trackPage(href);
  }, [ready, eligible, choice, href]);
  if (!ready || !eligible || choice !== null) return null;
  const malay = route.pathname === '/ms';
  return (
    <section className="analytics-choice" aria-label={malay ? 'Pilihan analitik' : 'Analytics choice'}>
      <div>
        <h2>{malay ? 'Bantu kami menambah baik Jentera' : 'Help us improve Jentera'}</h2>
        <p>{malay
          ? 'Benarkan analitik Google pada halaman awam? Pilihan anda tidak menjejaskan akses. Chat dan fail anda tidak dijejaki.'
          : 'Allow Google analytics on public pages? Your choice won’t affect access. Your chats and files aren’t tracked.'}{' '}
          <Link to="/privacy#analytics-settings">{malay ? 'Privasi & tetapan' : 'Privacy & settings'}</Link>
        </p>
        {error ? <p role="alert">{malay ? 'Pilihan tidak dapat disimpan. Analitik kekal dimatikan.' : 'Your choice couldn’t be saved. Analytics remains off.'}</p> : null}
      </div>
      <div className="analytics-choice-actions">
        <button type="button" onClick={() => choose('denied')}>{malay ? 'Tidak, terima kasih' : 'No thanks'}</button>
        <button type="button" onClick={() => choose('allowed')}>{malay ? 'Benarkan analitik' : 'Allow analytics'}</button>
      </div>
    </section>
  );
}

export function AnalyticsSettings({ malay = false }: { malay?: boolean }) {
  const { choice, ready, error, choose } = useAnalyticsChoice();
  const blocked = ready && (analyticsPrivacyOptOut() || isNative());
  return (
    <section id="analytics-settings" className="analytics-settings">
      <h2>{malay ? 'Pilihan analitik Google' : 'Google analytics preferences'}</h2>
      <p>{malay
        ? 'Analitik Google pilihan digunakan hanya pada halaman awam. Anda boleh mengubah pilihan di sini; akses akaun tidak terjejas.'
        : 'Optional Google analytics runs only on public pages. Change your choice here at any time; account access is unaffected.'}</p>
      {blocked ? <p>{malay ? 'Analitik Google dimatikan oleh pilihan privasi pelayar anda atau dalam aplikasi asli.' : 'Google analytics is off because of your browser privacy preference or native app environment.'}</p> : (
        <div className="analytics-choice-actions">
          <button type="button" disabled={!ready} aria-pressed={choice === 'denied'} onClick={() => choose('denied')}>{malay ? 'Matikan analitik Google' : 'Disable Google analytics'}</button>
          <button type="button" disabled={!ready} aria-pressed={choice === 'allowed'} onClick={() => choose('allowed')}>{malay ? 'Hidupkan analitik Google' : 'Enable Google analytics'}</button>
        </div>
      )}
      {error ? <p role="alert">{malay ? 'Pilihan tidak dapat disimpan.' : 'Your choice couldn’t be saved.'}</p> : null}
    </section>
  );
}
