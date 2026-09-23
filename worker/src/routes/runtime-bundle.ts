/* ============================================================
   GET /v1/runtime/bundle/<commit>.tar.gz — the runner bundle, to a sprite.

   This route exists so the repository can be private. A sprite used to build
   its runner directory from 24 curls against raw.githubusercontent.com, which
   serves public repositories anonymously and nothing else; making the repo
   private answered 404 to every bootstrap and killed the next fresh provision
   with curl exit 22, so visibility was reverted the same day.

   It is mounted with the other /v1/runtime routes, ahead of guardApiRequest,
   because a sprite presents a ticket rather than a session cookie.

   Everything that is not an exact, entitled hit answers 404. A 403 would
   confirm that a commit exists and that its bundle is there to be had; the
   same reasoning as runVisibleTo, which answers 404 for a colleague's private
   run so the id alone confirms nothing.
   ============================================================ */

import type { Env } from '../env';
import { bundleTicketIsValid } from '../runtime/bundle-token';

const PREFIX = '/v1/runtime/bundle/';

/** Where a commit's bundle lives in the bucket.
 *  worker/scripts/bundle-pack.mjs writes this same key; its test asserts the
 *  two agree, because a bundle uploaded to a key nothing reads is an outage
 *  that passes every check on both sides. */
export const bundleKey = (commit: string) => `bundles/${commit}.tar.gz`;

export async function handleRuntimeBundle(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith(PREFIX)) return null;
  const miss = () => new Response('not found', { status: 404 });

  /* GET alone. HEAD would have to be added to Access-Control-Allow-Methods to
     satisfy test/cors.test.ts, and widening a method allowlist for a route no
     browser calls, to serve a request nothing makes, is a bad trade. */
  if (request.method !== 'GET') return miss();

  const commit = url.pathname.slice(PREFIX.length).replace(/\.tar\.gz$/, '');
  if (!/^[0-9a-f]{40}$/.test(commit)) return miss();

  const ticket = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!(await bundleTicketIsValid(env, commit, ticket))) return miss();

  /* No binding means the deployment predates the bucket. Answering 404 keeps
     the failure in the bootstrap's own output rather than as a Worker
     exception nothing reads. */
  const bucket = env.RUNTIME_BUNDLES;
  if (!bucket) return miss();

  const object = await bucket.get(bundleKey(commit));
  if (!object) return miss();

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': 'application/gzip',
      'content-length': String(object.size),
      /* A commit's bundle is immutable by construction, so anything between
         here and the sprite may keep it for as long as it likes. */
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
