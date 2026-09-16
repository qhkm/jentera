import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - build script, checked here rather than typed
import { associationFiles } from '../../scripts/app-links.mjs';

/* Relative to app/, which is vitest's working directory here. */
const repo = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const TEAM = 'ABCDE12345';
const FINGERPRINT = Array.from({ length: 32 }, () => 'AB').join(':');

describe('App Link association', () => {
  it('writes nothing while the platform values are unknown', () => {
    const { files, skipped } = associationFiles({});
    expect(files).toEqual({});
    /* Silence here would be the dangerous outcome: both platforms cache a
       bad association and the callback quietly falls back to the browser. */
    expect(skipped.join(' ')).toMatch(/JENTERA_APPLE_TEAM_ID is not set/);
    expect(skipped.join(' ')).toMatch(/JENTERA_ANDROID_CERT_SHA256 is not set/);
  });

  it('refuses a malformed team id or fingerprint rather than shipping it', () => {
    const { files, skipped } = associationFiles({
      JENTERA_APPLE_TEAM_ID: 'TOO-SHORT',
      JENTERA_ANDROID_CERT_SHA256: 'not-a-fingerprint',
    });
    expect(files).toEqual({});
    expect(skipped).toHaveLength(2);
  });

  it('scopes both files to the callback and the signed app', () => {
    const { files, skipped } = associationFiles({
      JENTERA_APPLE_TEAM_ID: TEAM,
      JENTERA_ANDROID_CERT_SHA256: `${FINGERPRINT} , ${FINGERPRINT.toLowerCase()}`,
    });
    expect(skipped).toEqual([]);

    const apple = JSON.parse(files['apple-app-site-association']);
    expect(apple.applinks.details[0].appIDs).toEqual([`${TEAM}.ai.jentera.app`]);
    expect(apple.applinks.details[0].components[0]['/']).toBe('/app-auth');

    const android = JSON.parse(files['assetlinks.json']);
    expect(android[0].target.package_name).toBe('ai.jentera.app');
    /* Upper-cased and de-spaced: Android compares the string as written. */
    expect(android[0].target.sha256_cert_fingerprints).toEqual([FINGERPRINT, FINGERPRINT]);
  });

  it('is served as JSON from a path Pages does not rewrite', () => {
    const headers = repo('public/_headers');
    expect(headers).toMatch(/\/\.well-known\/apple-app-site-association\n {2}Content-Type: application\/json/);
    const redirects = repo('public/_redirects');
    expect(redirects).not.toMatch(/well-known/);
    expect(redirects).not.toMatch(/app-auth/);
  });

  it('is the link Android verifies, with the claimable scheme kept only inbound', () => {
    const manifest = repo('../mobile/android/app/src/main/AndroidManifest.xml');
    expect(manifest).toMatch(/<intent-filter android:autoVerify="true">/);
    expect(manifest).toMatch(/android:scheme="https" android:host="jentera\.ai" android:path="\/app-auth"/);
    const entitlements = repo('../mobile/ios/App/App/App.entitlements');
    expect(entitlements).toMatch(/applinks:jentera\.ai/);
    expect(repo('../mobile/ios/App/App.xcodeproj/project.pbxproj'))
      .toMatch(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/);
  });
});
