#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERMES_COMMIT = 'bb0305ae08bf1dc9ac5a39d2b017f27e42854170';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_DIRS = ['cron', 'sessions', 'logs', 'pairing', 'hooks', 'image_cache', 'audio_cache', 'memories'];
const INSTALL_DIRS = ['hermes-agent', 'bin', 'node', 'skills'];
const TEMPLATES = ['.env', 'config.yaml', 'SOUL.md', '.no-bundled-skills'];

async function entries(directory) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unclean spare');
    return await fs.readdir(directory);
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function clean(home, installing = false) {
  const aisar = path.join(home, 'aisar');
  const allowed = new Set(['runner', 'bootstrap.env.in', 'spare-state.json']);
  if ((await entries(aisar)).some(name => !allowed.has(name))) throw new Error('unclean spare');
  const hermes = path.join(home, '.hermes');
  const allowedHermes = new Set([...INSTALL_DIRS, ...EMPTY_DIRS, ...(installing ? TEMPLATES : [])]);
  const names = await entries(hermes);
  if (names.some(name => !allowedHermes.has(name))) throw new Error('unclean spare');
  for (const name of names) {
    const stat = await fs.lstat(path.join(hermes, name));
    if (stat.isSymbolicLink() || (TEMPLATES.includes(name) ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('unclean spare');
    }
  }
  for (const name of EMPTY_DIRS) {
    if ((await entries(path.join(hermes, name))).length) throw new Error('unclean spare');
  }
}

/** Tests supply an isolated fixture root; production CLI always uses the
 * fixed Sprite home. Never sanitize or delete an existing customer's home. */
export async function spareState(mode, release, bundle, businessId, home = '/home/sprite') {
  if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$/.test(release ?? '') ||
      !/^[0-9a-f]{40}$/.test(bundle ?? '') || !['start', 'finish', 'claim'].includes(mode)) {
    throw new Error('invalid spare operation');
  }
  const marker = path.join(home, 'aisar', 'spare-state.json');
  if (mode === 'start') {
    // A preparation cannot run on ANY previous Hermes installation.
    try { await fs.lstat(path.join(home, '.hermes')); throw new Error('existing installation'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await clean(home);
    await fs.writeFile(marker, JSON.stringify({ state: 'preparing', release, bundle, hermesCommit: HERMES_COMMIT }),
      { mode: 0o600, flag: 'wx' });
    return;
  }
  const stat = await fs.lstat(marker);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw new Error('invalid spare marker');
  const record = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (record.release !== release || record.bundle !== bundle || record.hermesCommit !== HERMES_COMMIT) {
    throw new Error('spare pin mismatch');
  }
  if (mode === 'finish') {
    if (record.state !== 'preparing') throw new Error('spare already used');
    await clean(home, true);
    // Only installer-generated templates from THIS proven fresh preparation.
    // The validated files are unlinked individually, never a directory tree.
    for (const name of TEMPLATES) {
      await fs.unlink(path.join(home, '.hermes', name)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await clean(home);
    record.state = 'prepared';
  } else {
    if (!UUID.test(businessId ?? '')) throw new Error('invalid spare owner');
    // Retry only for the same assigned business. Its data is never cleared.
    if (record.state === 'assigned' && record.businessId === businessId) return;
    if (record.state !== 'prepared') throw new Error('spare already used');
    await clean(home);
    record.state = 'assigned'; record.businessId = businessId;
  }
  // Replace atomically: an interruption cannot turn an assigned marker back
  // into a prepared one. DB assignment is the single concurrency authority.
  const temporary = `${marker}.next`;
  await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, marker);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, release, bundle, businessId] = process.argv.slice(2);
  spareState(mode, release, bundle, businessId).catch(() => {
    console.error('spare clean-state check failed'); process.exitCode = 1;
  });
}
