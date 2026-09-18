import { describe, expect, it } from 'vitest';
import { returnPath } from '@/lib/return-path';

describe('where a sign-in puts the owner back', () => {
  it('keeps the page they were on', () => {
    expect(returnPath('/app?view=chat')).toBe('/app?view=chat');
    expect(returnPath('/app?view=business&tab=connections#connection-tokens-bukku'))
      .toBe('/app?view=business&tab=connections#connection-tokens-bukku');
  });

  /* Our own sign-in must not become a way to land someone elsewhere while
     wearing our address. */
  it('refuses anything that leaves the app', () => {
    const backslash = String.fromCharCode(92);
    const newline = String.fromCharCode(10);
    const hostile = [
      'https://evil.example/app',
      '//evil.example',
      `/${backslash}evil.example`,
      'javascript:alert(1)',
      'app?view=chat',
      `/app${newline}Set-Cookie: x=1`,
      `/app?x=${'a'.repeat(600)}`,
    ];
    for (const value of hostile) expect(returnPath(value), value).toBe('');
  });

  it('refuses paths that are not pages, and nothing at all', () => {
    for (const value of ['/api/me', '/signin', '/join?token=x', '', null, undefined]) {
      expect(returnPath(value)).toBe('');
    }
  });
});
