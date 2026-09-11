import { describe, expect, it } from 'vitest';
import { notificationFromPush, targetUrl } from '@/pwa/sw-push';

describe('what the service worker shows for a push', () => {
  it('turns the worker payload into a notification with the brand icon and the target kept for the tap', () => {
    const shown = notificationFromPush({ title: 'Weekly summary is ready', body: 'Three things need you.', url: '/app?view=notifications', tag: 'routine-1' });
    expect(shown.title).toBe('Weekly summary is ready');
    expect(shown.options).toMatchObject({
      body: 'Three things need you.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'routine-1',
      data: { url: '/app?view=notifications' },
    });
  });

  it('never shows an empty or foreign notification', () => {
    expect(notificationFromPush(null).title).toBe('Jentera');
    expect(notificationFromPush('garbage').options.body).toBe('');
    expect(notificationFromPush({ title: 'x', body: 'y', url: 'https://evil.example/phish' }).options.data).toEqual({ url: '/app' });
  });

  it('resolves the tap target inside the app origin only', () => {
    const origin = 'https://jentera.ai';
    expect(targetUrl({ url: '/app?view=chat' }, origin)).toBe('https://jentera.ai/app?view=chat');
    expect(targetUrl({ url: 'https://evil.example/x' }, origin)).toBe('https://jentera.ai/app');
    expect(targetUrl(undefined, origin)).toBe('https://jentera.ai/app');
  });
});
