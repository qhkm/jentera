import { HERMES_COMMIT } from './hermes-pin';
import type { Env } from '../env';
import { withUser } from '../db';
import { FlySpriteProvider } from './fly-sprite-provider';
import { canBootstrap, type RuntimeProvider } from './provider';
import { sparePoolConfig, type SpareRetirementQueueMessage } from './spares';
import type { RuntimeMessageResult } from './consumer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class UnsafeSpare extends Error {}
interface Retirement {
  spare_id: string; provider_name: string; provider_id: string | null; provider_url: string | null;
  release: string; bundle_commit: string; never_prepared: boolean;
}

/** Read-only attestation, portable to the previous published bundle. Never
 * writes installed files, adopts an owner, starts a browser or sanitizes data.
 * The optional paths/command are isolated unit-test seams, not request inputs. */
export function retirementCheckScript(home = '/home/sprite', services = ['sprite-env', 'services', 'list']): string {
  return `
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const home = ${JSON.stringify(home)};
const services = ${JSON.stringify(services)};
const expectedRelease = process.argv[1];
const expectedBundle = process.argv[2];
function directory(p) {
  const s=fs.lstatSync(p); if(!s.isDirectory() || s.isSymbolicLink()) throw Error();
  return fs.readdirSync(p);
}
try {
  const marker=path.join(home,'aisar','spare-state.json');
  const stat=fs.lstatSync(marker);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>2048 || (stat.mode & 511)!==384) throw Error();
  const m=JSON.parse(fs.readFileSync(marker,'utf8'));
  if(m.state!=='prepared' || m.release!==expectedRelease || m.bundle!==expectedBundle ||
    m.hermesCommit!==${JSON.stringify(HERMES_COMMIT)} ||
    Object.keys(m).sort().join(',')!=='bundle,hermesCommit,release,state') throw Error();
  if(directory(path.join(home,'aisar')).some(n=>!['runner','spare-state.json'].includes(n))) throw Error();
  const empty=['cron','sessions','logs','pairing','hooks','image_cache','audio_cache','memories'];
  const allowed=[...empty,'hermes-agent','bin','node','skills'];
  for(const n of directory(path.join(home,'.hermes'))) {
    if(!allowed.includes(n)) throw Error();
    const names=directory(path.join(home,'.hermes',n));
    if(empty.includes(n) && names.length) throw Error();
  }
  const active=JSON.parse(execFileSync(services[0],services.slice(1),{encoding:'utf8',timeout:5000}));
  if(!Array.isArray(active) || active.length) throw Error();
  console.log(JSON.stringify({clean:true,release:m.release,bundle:m.bundle}));
} catch { console.error('unused spare attestation refused'); process.exitCode=1; }
`;
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export async function retireRuntimeSpare(
  env: Env, message: SpareRetirementQueueMessage, options: { provider?: RuntimeProvider } = {},
): Promise<RuntimeMessageResult> {
  if (!sparePoolConfig(env) || env.RUNTIME_SPARE_POOL_RECOVERY_ENABLED !== 'true' ||
      message.kind !== 'retire_spare' || !UUID.test(message.spareId)) return { action: 'ack', reason: 'missing' };
  const provider = options.provider ?? new FlySpriteProvider({ token: env.SPRITES_TOKEN!,
    apiOrigin: env.SPRITES_API_ORIGIN, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
  });
  if (provider.id !== 'fly-sprite' || !canBootstrap(provider) || !provider.lookup) return { action: 'ack', reason: 'missing' };
  const token = crypto.randomUUID();
  const [spare] = await withUser(env, sql => sql<Retirement[]>`
    select * from public.lease_runtime_spare_retirement(${message.spareId},${token})`);
  if (!spare) return { action: 'ack', reason: 'already_done' };
  try {
    if (!/^aisar-p-[0-9a-f]{32}$/.test(spare.provider_name)) throw new UnsafeSpare();
    const resource = await provider.lookup(spare.provider_name);
    if (resource) {
      if (resource.provider !== 'fly-sprite' || resource.name !== spare.provider_name || !resource.id ||
          !/^https:\/\/[a-zA-Z0-9.-]+\.sprites\.app$/.test(resource.url) ||
          (spare.provider_id && resource.id !== spare.provider_id) ||
          (spare.provider_url && resource.url !== spare.provider_url)) throw new UnsafeSpare();
      const check = await provider.exec(resource, '/bin/bash', ['-lc',
        `exec timeout -k 1 15 /.sprite/bin/node -e ${shellQuote(retirementCheckScript())} -- ${shellQuote(spare.release)} ${shellQuote(spare.bundle_commit)}`,
      ]);
      let attested: { clean?: boolean; release?: string; bundle?: string } = {};
      try { attested = JSON.parse(check.stdout.trim()); } catch { /* Refuse malformed attestation. */ }
      if (check.exitCode !== 0 || !attested.clean || attested.release !== spare.release ||
          attested.bundle !== spare.bundle_commit) throw new UnsafeSpare();
      const [authorized] = await withUser(env, sql => sql<{ ok: boolean }[]>`
        select public.runtime_spare_retirement_authorized(${spare.spare_id},${token}) as ok`);
      if (!authorized?.ok) return { action: 'ack', reason: 'already_done' };
      await provider.destroy(resource);
      if (await provider.lookup(spare.provider_name)) throw new Error('provider deletion not confirmed');
    } else if (!spare.provider_id && !spare.never_prepared) {
      // An interrupted create may complete late. Missing is not proof that
      // unknown/abandoned preparation can be safely forgotten and replaced.
      throw new UnsafeSpare();
    }
    const [saved] = await withUser(env, sql => sql<{ ok: boolean }[]>`
      select public.finish_runtime_spare_retirement(${spare.spare_id},${token},true,false) as ok`);
    if (!saved?.ok) return { action: 'ack', reason: 'already_done' };
    console.info('[runtime-spares] unused resource retired after confirmed absence');
    return { action: 'ack', reason: 'completed' };
  } catch (error) {
    await withUser(env, sql => sql`select public.finish_runtime_spare_retirement(
      ${spare.spare_id},${token},false,${error instanceof UnsafeSpare})`);
    console.warn('[runtime-spares] retirement deferred; quarantined budget retained');
    return { action: 'ack', reason: 'failed' };
  }
}
