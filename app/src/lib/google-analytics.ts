import { isNative } from '@/lib/native';
import { pageSeo } from '@/lib/seo';

export const GOOGLE_ANALYTICS_ID = 'G-VF5X89K0MC';
const DISABLE_KEY = `ga-disable-${GOOGLE_ANALYTICS_ID}` as const;
export const ANALYTICS_CHOICE_KEY = 'jentera-google-analytics-choice-v1';
export const ANALYTICS_CHOICE_EVENT = 'jentera:analytics-choice';
const CHOICE_AGE = 180 * 24 * 60 * 60 * 1_000;
const SCRIPT_ID = 'jentera-google-tag';
let volatileOptOut = false;
const LIVE_HOSTS = new Set(['jentera.ai', 'jentera.aisar.ai']);
const PUBLIC_PATHS = new Set([
  '/', '/ms', '/pricing', '/about', '/connect', '/connect/telegram',
  '/connect/google-calendar', '/privacy', '/terms',
]);

// Never accept arbitrary campaign strings: these fields can also contain PII.
const CAMPAIGNS: Record<string, ReadonlySet<string>> = {
  utm_source: new Set(['facebook', 'instagram', 'whatsapp', 'tiktok', 'google', 'telegram', 'linkedin', 'youtube', 'email']),
  utm_medium: new Set(['social', 'paid_social', 'email', 'referral', 'cpc', 'organic']),
  utm_campaign: new Set(['launch', 'jentera_launch', 'launch_2026']),
  utm_content: new Set(['hero', 'footer', 'announcement', 'founder', 'launch_post', 'referral']),
};

export type AnalyticsChoice = 'allowed' | 'denied';
type GoogleCommand = (...args: unknown[]) => void;
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: GoogleCommand;
  [DISABLE_KEY]?: boolean;
};

export function analyticsPrivacyOptOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.doNotTrack === '1' ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function readAnalyticsChoice(): AnalyticsChoice | null {
  if (volatileOptOut) return 'denied';
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(ANALYTICS_CHOICE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object' || !('choice' in saved) || !('at' in saved)) return null;
    if ((saved.choice !== 'allowed' && saved.choice !== 'denied') || typeof saved.at !== 'number' ||
      !Number.isFinite(saved.at) || saved.at > Date.now() || Date.now() - saved.at >= CHOICE_AGE) return null;
    return saved.choice;
  } catch { return null; }
}

function isGoogleDebugParameter(key: string, value: string): boolean {
  // Tag Assistant adds a boolean flag or numeric timestamp, never arbitrary text.
  return (key === '_dbg' && value === '1') ||
    (key === 'gtm_debug' && /^[0-9]{1,13}$/.test(value));
}

export function publicAnalyticsPage(href: string): URL | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || !LIVE_HOSTS.has(url.hostname) || url.port || url.username || url.password ||
      !PUBLIC_PATHS.has(url.pathname)) return null;
    // Unknown parameters might be sign-in codes, emails, redirect URLs or tokens.
    for (const [key, value] of url.searchParams) {
      if (url.searchParams.getAll(key).length !== 1 ||
        (!isGoogleDebugParameter(key, value) && !CAMPAIGNS[key]?.has(value))) return null;
    }
    return url;
  } catch { return null; }
}

function disableGoogle(): void {
  const browser = window as AnalyticsWindow;
  browser[DISABLE_KEY] = true;
}

function clearGoogleCookies(): void {
  const names = document.cookie.split(';').map((cookie) => cookie.trim().split('=')[0])
    .filter((name) => /^_ga(?:_[A-Za-z0-9]+)?$/.test(name));
  const parts = location.hostname.split('.');
  const domains = ['', ...parts.map((_, i) => parts.slice(i).join('.')).filter((domain) => domain.includes('.'))];
  for (const name of names) for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain ? `; Domain=${domain}` : ''}`;
  }
}

/** Fail closed if browser storage is unavailable. No Google request before opt-in. */
export function saveAnalyticsChoice(choice: AnalyticsChoice): boolean {
  if (choice === 'denied') {
    volatileOptOut = true;
    disableGoogle();
    clearGoogleCookies();
  }
  try {
    localStorage.setItem(ANALYTICS_CHOICE_KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT));
    return false;
  }
  volatileOptOut = choice === 'denied';
  window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT));
  // Removing a script element cannot unload its code. Reload on withdrawal.
  if (choice === 'denied' && document.getElementById(SCRIPT_ID)) location.reload();
  return true;
}

/** Google code must not follow the SPA into sign-in, Chat or any private screen.
 * Disable first, then navigate as a new document without changing SPA history.
 * The private document will never load this tag, even with a saved opt-in.
 */
export function installAnalyticsNavigationBoundary(
  navigate: (href: string, replace: boolean) => void = (href, replace) => {
    if (replace) location.replace(href);
    else location.assign(href);
  },
): () => void {
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const guard = (original: History['pushState'], replace: boolean): History['pushState'] =>
    function (data, unused, href) {
      if (href != null) {
        const target = new URL(String(href), location.href);
        if (target.origin === location.origin && !publicAnalyticsPage(target.href)) {
          disableGoogle();
          navigate(target.href, replace);
          return;
        }
      }
      original.call(history, data, unused, href);
    };
  history.pushState = guard(originalPush, false);
  history.replaceState = guard(originalReplace, true);
  const onPop = () => {
    if (!publicAnalyticsPage(location.href)) {
      disableGoogle();
      navigate(location.href, true);
    }
  };
  window.addEventListener('popstate', onPop, true);
  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', onPop, true);
  };
}

export function createGoogleAnalyticsClient() {
  let initialized = false;
  let lastPage = '';
  let removeBoundary: (() => void) | undefined;

  return {
    trackPage(href = location.href): void {
      const page = publicAnalyticsPage(href);
      if (!page || isNative() || analyticsPrivacyOptOut() || readAnalyticsChoice() !== 'allowed') {
        disableGoogle();
        return;
      }
      const browser = window as AnalyticsWindow;
      browser[DISABLE_KEY] = false;
      const pageLocation = `${page.origin}${page.pathname}`;
      const title = pageSeo(page.pathname).title;
      const debug = page.searchParams.has('_dbg') || page.searchParams.has('gtm_debug')
        ? { debug_mode: true } : {};
      let referrer = '';
      try {
        const source = new URL(document.referrer);
        if (source.protocol === 'https:' || source.protocol === 'http:') referrer = source.origin;
      } catch { /* No referrer is normal. */ }
      const campaign = Object.fromEntries([
        ['campaign_source', page.searchParams.get('utm_source')],
        ['campaign_medium', page.searchParams.get('utm_medium')],
        ['campaign_name', page.searchParams.get('utm_campaign')],
        ['campaign_content', page.searchParams.get('utm_content')],
      ].filter((entry) => entry[1] !== null));
      if (!initialized) {
        browser.dataLayer ??= [];
        browser.gtag = function () { browser.dataLayer!.push(arguments); };
        browser.gtag('consent', 'default', {
          analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
        });
        browser.gtag('consent', 'update', { analytics_storage: 'granted' });
        browser.gtag('js', new Date());
        browser.gtag('set', 'ads_data_redaction', true);
        browser.gtag('config', GOOGLE_ANALYTICS_ID, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          cookie_flags: 'SameSite=Lax;Secure',
          cookie_expires: CHOICE_AGE / 1_000,
          cookie_update: false,
          page_location: pageLocation,
          page_title: title,
          page_referrer: referrer,
          ...campaign,
          ...debug,
        });
        removeBoundary = installAnalyticsNavigationBoundary();
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.async = true;
        script.referrerPolicy = 'no-referrer';
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`;
        document.head.append(script);
        initialized = true;
      }
      // Query/hash changes and React Strict Mode must not duplicate pageviews.
      if (lastPage === pageLocation) return;
      browser.gtag?.('set', { page_location: pageLocation, page_title: title, page_referrer: referrer });
      browser.gtag?.('event', 'page_view', {
        send_to: GOOGLE_ANALYTICS_ID, page_location: pageLocation, page_title: title, page_referrer: referrer,
        ...debug,
      });
      lastPage = pageLocation;
    },
    stop(): void {
      disableGoogle();
      removeBoundary?.();
    },
  };
}

export const googleAnalytics = createGoogleAnalyticsClient();
