/* The App Link association files, written into dist/.well-known at build.
 *
 * A file is produced only when every value it needs is present and well
 * formed. A wrong association is worse than none: both platforms fetch these
 * once, cache what they get, and fail silently — the sign-in callback opens
 * the browser, or another app, while everything looks configured. So a
 * missing value prints why and leaves the file out, and the native doors stay
 * shut behind NATIVE_AUTH_ENABLED until both files are real.
 *
 *   JENTERA_APPLE_TEAM_ID        10-character Apple Developer team ID.
 *   JENTERA_ANDROID_CERT_SHA256  Comma-separated SHA-256 fingerprints of every
 *                                certificate allowed to receive the callback:
 *                                the Play App Signing certificate, and the
 *                                upload certificate while testing. Both are in
 *                                Play Console under Setup → App signing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const APP_ID = 'ai.jentera.app';
const TEAM_ID = /^[A-Z0-9]{10}$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** What belongs in dist/.well-known for these values, and why anything is missing. */
export function associationFiles(env = process.env) {
  const files = {};
  const skipped = [];

  const team = (env.JENTERA_APPLE_TEAM_ID ?? '').trim();
  if (TEAM_ID.test(team)) {
    /* Scoped to the callback alone. An association over the whole site would
       make every jentera.ai link try to open the app. */
    files['apple-app-site-association'] = `${JSON.stringify({
      applinks: {
        details: [{ appIDs: [`${team}.${APP_ID}`], components: [{ '/': '/app-auth', '?': { code: '?*' } }] }],
      },
    }, null, 2)}\n`;
  } else {
    skipped.push(`apple-app-site-association: JENTERA_APPLE_TEAM_ID is ${team ? 'not a 10-character team ID' : 'not set'}`);
  }

  const fingerprints = (env.JENTERA_ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (fingerprints.length > 0 && fingerprints.every((value) => FINGERPRINT.test(value))) {
    files['assetlinks.json'] = `${JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: fingerprints },
    }], null, 2)}\n`;
  } else {
    skipped.push(`assetlinks.json: JENTERA_ANDROID_CERT_SHA256 ${fingerprints.length === 0
      ? 'is not set'
      : 'holds a value that is not a colon-separated SHA-256'}`);
  }

  return { files, skipped };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = new URL('../dist/.well-known/', import.meta.url);
  const { files, skipped } = associationFiles();
  await mkdir(dist, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(new URL(name, dist), body);
  for (const reason of skipped) console.warn(`[app-links] not written — ${reason}`);
  if (skipped.length === 0) console.log('[app-links] wrote apple-app-site-association and assetlinks.json');
}
