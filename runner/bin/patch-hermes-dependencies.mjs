#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
const verify = process.argv.includes('--verify');
const testTarget = process.env.NODE_ENV === 'test' &&
  /\/aisar-hermes-test-[^/]+$/.test(root ?? '');
if (!root?.startsWith('/home/sprite/.hermes/hermes-agent') && !testTarget) {
  throw new Error('Hermes dependency patch target is not allowed');
}

const packagePath = join(root, 'package.json');
const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
const current = manifest?.overrides?.['nanoid@^3'];
if (!['3.3.17', '3.3.18'].includes(current)) {
  throw new Error(`unreviewed Hermes nanoid override: ${String(current)}`);
}
manifest.overrides['nanoid@^3'] = '3.3.18';
if (!verify) {
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write('pinned Hermes nanoid override to 3.3.18\n');
  process.exit(0);
}

const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const vulnerable = Object.entries(lock.packages ?? {})
  .filter(([path, pkg]) => path.endsWith('/nanoid') || pkg?.name === 'nanoid')
  .filter(([, pkg]) => pkg?.version === '3.3.17');
if (vulnerable.length > 0) {
  throw new Error(`vulnerable nanoid remains at ${vulnerable.map(([path]) => path).join(', ')}`);
}
process.stdout.write('Hermes production dependency override verified\n');
