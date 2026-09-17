// @vitest-environment-options {"url":"https://jentera.ai/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_CHOICE_KEY, GOOGLE_ANALYTICS_ID, createGoogleAnalyticsClient,
  installAnalyticsNavigationBoundary, publicAnalyticsPage, readAnalyticsChoice, saveAnalyticsChoice,
} from '@/lib/google-analytics';

const browser = window as Window & {
  dataLayer?: Array<ArrayLike<unknown>>;
  gtag?: unknown;
  'ga-disable-G-VF5X89K0MC'?: boolean;
};
let client: ReturnType<typeof createGoogleAnalyticsClient>;
const cleanups: Array<() => void> = [];
const commands = () => (browser.dataLayer ?? []).map((entry) => Array.from(entry));

beforeEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  saveAnalyticsChoice('allowed'); // Reset a previous in-memory withdrawal.
  localStorage.clear();
  delete browser.dataLayer;
  delete browser.gtag;
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: undefined });
  client = createGoogleAnalyticsClient();
});

afterEach(() => {
  client.stop();
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  document.getElementById('jentera-google-tag')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('public-page Google analytics', () => {
  it('makes no Google request before consent or after a saved denial', () => {
    client.trackPage();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
    saveAnalyticsChoice('denied');
    client.trackPage();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
    expect(commands()).toEqual([]);
  });

  it('loads the supplied ID asynchronously after opt-in with advertising disabled', () => {
    saveAnalyticsChoice('allowed');
    client.trackPage();
    const script = document.getElementById('jentera-google-tag') as HTMLScriptElement;
    expect(script.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`);
    expect(script.async).toBe(true);
    expect(script.referrerPolicy).toBe('no-referrer');
    expect(commands()[0]).toEqual(['consent', 'default', {
      analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    }]);
    expect(commands()[1]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(commands().find((entry) => entry[0] === 'config')?.[2]).toMatchObject({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    });
  });

  it('sends one manual pageview per public route, not per effect or anchor change', () => {
    saveAnalyticsChoice('allowed');
    client.trackPage();
    client.trackPage();
    client.trackPage('https://jentera.ai/#pricing');
    client.trackPage('https://jentera.ai/pricing');
    const views = commands().filter((entry) => entry[0] === 'event');
    expect(views).toHaveLength(2);
    expect(views[1]).toEqual(['event', 'page_view', expect.objectContaining({
      send_to: GOOGLE_ANALYTICS_ID, page_location: 'https://jentera.ai/pricing', page_title: 'Pricing — Jentera',
    })]);
    expect(document.querySelectorAll('#jentera-google-tag')).toHaveLength(1);
  });

  it('strips query strings, fragments and referrer paths, using only approved campaign labels', () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://facebook.com/posts/private?email=secret@example.com#secret');
    saveAnalyticsChoice('allowed');
    client.trackPage('https://jentera.ai/?utm_source=whatsapp&utm_medium=social&utm_campaign=launch#pricing');
    const config = commands().find((entry) => entry[0] === 'config')?.[2];
    expect(config).toMatchObject({ page_location: 'https://jentera.ai/', page_referrer: 'https://facebook.com', campaign_source: 'whatsapp', campaign_name: 'launch' });
    const serialized = JSON.stringify(commands());
    expect(serialized).not.toMatch(/secret|example\.com|utm_source|#pricing/);
  });

  it.each(['?_dbg=1', '?gtm_debug=1789600000000', '?_dbg=1&gtm_debug=1789600000000&utm_source=whatsapp'])('accepts a bounded Tag Assistant signal without including it in page URLs: %s', (query) => {
    expect(publicAnalyticsPage(`https://jentera.ai/${query}`)).not.toBeNull();
    client.trackPage(`https://jentera.ai/${query}`);
    expect(document.getElementById('jentera-google-tag')).toBeNull();
    saveAnalyticsChoice('allowed');
    client.trackPage(`https://jentera.ai/${query}`);
    expect(document.getElementById('jentera-google-tag')).not.toBeNull();
    const config = commands().find((entry) => entry[0] === 'config')?.[2];
    expect(config).toMatchObject({ debug_mode: true, page_location: 'https://jentera.ai/' });
    expect(commands().find((entry) => entry[0] === 'event')?.[2]).toMatchObject({ debug_mode: true, page_location: 'https://jentera.ai/' });
    expect(JSON.stringify(commands())).not.toMatch(/_dbg|gtm_debug|1789600000000/);
  });

  it('does not enable debug mode for ordinary visitors', () => {
    saveAnalyticsChoice('allowed');
    client.trackPage();
    expect(commands().find((entry) => entry[0] === 'config')?.[2]).not.toHaveProperty('debug_mode');
    expect(commands().find((entry) => entry[0] === 'event')?.[2]).not.toHaveProperty('debug_mode');
  });

  it.each(['?gtm_debug=', '?gtm_debug=private@example.com', '?gtm_debug=-1', '?gtm_debug=1.5', '?gtm_debug=12345678901234', '?gtm_debug=1&gtm_debug=2', '?_dbg=secret', '?_dbg=0', '?_dbg=1&_dbg=1', '?_dbg=1&token=secret', '?gtm_debug=1&email=private@example.com'])('rejects malformed or sensitive debugger URLs: %s', (query) => {
    saveAnalyticsChoice('allowed');
    client.trackPage(`https://jentera.ai/${query}`);
    expect(publicAnalyticsPage(`https://jentera.ai/${query}`)).toBeNull();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
    expect(commands()).toEqual([]);
  });

  it.each(['/signin', '/onboard', '/setup', '/app', '/subscribe', '/join', '/admin/launch'])('debug flags never authorize tracking on %s', (path) => {
    saveAnalyticsChoice('allowed');
    client.trackPage(`https://jentera.ai${path}?_dbg=1`);
    client.trackPage(`https://jentera.ai${path}?gtm_debug=1789600000000`);
    expect(document.getElementById('jentera-google-tag')).toBeNull();
    expect(commands()).toEqual([]);
  });

  it.each(['denied', 'doNotTrack', 'globalPrivacyControl', 'native', 'storage'] as const)('debug flags cannot override %s', (restriction) => {
    saveAnalyticsChoice('allowed');
    if (restriction === 'denied') saveAnalyticsChoice('denied');
    if (restriction === 'doNotTrack') Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    if (restriction === 'globalPrivacyControl') Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    if (restriction === 'native') vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    if (restriction === 'storage') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    client.trackPage('https://jentera.ai/?_dbg=1');
    client.trackPage('https://jentera.ai/?gtm_debug=1789600000000');
    expect(document.getElementById('jentera-google-tag')).toBeNull();
    expect(commands()).toEqual([]);
  });

  it.each(['/signin?token=secret', '/onboard', '/setup', '/app?view=chat', '/subscribe', '/join?token=secret', '/admin/launch', '/unknown'])('never loads on private or unknown route %s', (path) => {
    saveAnalyticsChoice('allowed');
    client.trackPage(`https://jentera.ai${path}`);
    expect(document.getElementById('jentera-google-tag')).toBeNull();
  });

  it.each(['http://jentera.ai/', 'https://preview.aisar-jentera.pages.dev/', 'http://localhost:5173/', 'https://aisar.ai/'])('does not contaminate production analytics from %s', (url) => {
    saveAnalyticsChoice('allowed');
    client.trackPage(url);
    expect(document.getElementById('jentera-google-tag')).toBeNull();
  });

  it.each(['?email=private@example.com', '?token=secret', '?code=secret', '?utm_source=private@example.com', '?utm_campaign=customer_name', '?utm_source=whatsapp&utm_source=email'])('rejects unapproved parameters %s', (query) => {
    expect(publicAnalyticsPage(`https://jentera.ai/${query}`)).toBeNull();
  });

  it.each(['doNotTrack', 'globalPrivacyControl'])('respects %s even after consent', (key) => {
    saveAnalyticsChoice('allowed');
    Object.defineProperty(navigator, key, { configurable: true, value: key === 'doNotTrack' ? '1' : true });
    client.trackPage();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
  });

  it('does not load in a native shell', () => {
    saveAnalyticsChoice('allowed');
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    client.trackPage();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
  });

  it('fails closed when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(saveAnalyticsChoice('allowed')).toBe(false);
    client.trackPage();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
  });

  it.each([null, '{', JSON.stringify({ choice: 'always', at: Date.now() }), JSON.stringify({ choice: 'allowed', at: Date.now() + 100_000 }), JSON.stringify({ choice: 'allowed', at: 0 })])('rejects malformed, future or expired choices: %s', (saved) => {
    if (saved !== null) localStorage.setItem(ANALYTICS_CHOICE_KEY, saved);
    expect(readAnalyticsChoice()).toBeNull();
  });

  it('withdraws immediately and removes accessible analytics cookies without touching auth cookies', () => {
    document.cookie = '_ga=tracking; Path=/; Secure';
    document.cookie = '_ga_VF5X89K0MC=tracking; Path=/; Secure';
    document.cookie = 'jentera_test_session=essential; Path=/; Secure';
    saveAnalyticsChoice('denied');
    expect(browser[`ga-disable-${GOOGLE_ANALYTICS_ID}`]).toBe(true);
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toContain('jentera_test_session=essential');
    expect(readAnalyticsChoice()).toBe('denied');
    document.cookie = 'jentera_test_session=; Max-Age=0; Path=/';
  });

  it('still disables tracking when withdrawal cannot be persisted', () => {
    saveAnalyticsChoice('allowed');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(saveAnalyticsChoice('denied')).toBe(false);
    expect(readAnalyticsChoice()).toBe('denied');
    client.trackPage();
    expect(document.getElementById('jentera-google-tag')).toBeNull();
  });
});

describe('private navigation boundary', () => {
  it.each([
    ['pushState', '/signin?mode=signup', false],
    ['replaceState', '/app?view=chat', true],
    ['pushState', '/?token=secret', false],
  ] as const)('uses document navigation before %s can change the URL to %s', (method, path, replace) => {
    const navigate = vi.fn();
    cleanups.push(installAnalyticsNavigationBoundary(navigate));
    history[method](null, '', path);
    expect(navigate).toHaveBeenCalledWith(`https://jentera.ai${path}`, replace);
    expect(location.pathname).toBe('/');
    expect(browser[`ga-disable-${GOOGLE_ANALYTICS_ID}`]).toBe(true);
  });

  it('keeps ordinary public SPA navigation working', () => {
    const navigate = vi.fn();
    cleanups.push(installAnalyticsNavigationBoundary(navigate));
    history.pushState(null, '', '/pricing');
    expect(location.pathname).toBe('/pricing');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps validated debugging navigation public but still guards sensitive destinations', () => {
    const navigate = vi.fn();
    cleanups.push(installAnalyticsNavigationBoundary(navigate));
    history.pushState(null, '', '/pricing?gtm_debug=1789600000000');
    expect(location.pathname).toBe('/pricing');
    expect(navigate).not.toHaveBeenCalled();
    history.pushState(null, '', '/app?_dbg=1');
    expect(navigate).toHaveBeenCalledWith('https://jentera.ai/app?_dbg=1', false);
    expect(location.pathname).toBe('/pricing');
  });

  it('reloads a private history entry on Back/Forward', () => {
    history.replaceState(null, '', '/app');
    const navigate = vi.fn();
    cleanups.push(installAnalyticsNavigationBoundary(navigate));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(navigate).toHaveBeenCalledWith('https://jentera.ai/app', true);
  });
});
