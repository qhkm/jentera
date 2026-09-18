import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../src/routes/session';

describe('where a sign-in puts the owner back', () => {
  it('keeps an in-app path', () => {
    expect(safeReturnPath('/app?view=chat')).toBe('/app?view=chat');
    expect(safeReturnPath('/app?view=business&tab=connections#connection-tokens-bukku'))
      .toBe('/app?view=business&tab=connections#connection-tokens-bukku');
  });

  /* Our own sign-in must not become a way to land someone elsewhere while
     wearing our address. */
  it('refuses anything that leaves the app', () => {
    const hostile = [
      'https://evil.example/app',
      '//evil.example',
      '/' + String.fromCharCode(92) + 'evil.example',
      'javascript:alert(1)',
      'app?view=chat',
      '/app' + String.fromCharCode(10) + 'Set-Cookie: x=1',
      '/app' + String.fromCharCode(0),
      '/app?x=' + 'a'.repeat(600),
    ];
    for (const value of hostile) expect(safeReturnPath(value), value).toBeNull();
  });

  it('refuses paths that are not pages', () => {
    /* The API answers JSON, and the sign-in screen is where they came from. */
    expect(safeReturnPath('/api/me')).toBeNull();
    expect(safeReturnPath('/signin')).toBeNull();
    expect(safeReturnPath('/join?token=x')).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, ['/app']]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });
});
