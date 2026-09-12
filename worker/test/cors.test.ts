import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function allowedMethods(): Promise<string[]> {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const match = source.match(/'Access-Control-Allow-Methods':\s*'([A-Z,]+)'/);
  if (!match) throw new Error('index.ts no longer states Access-Control-Allow-Methods');
  return match[1].split(',');
}

describe('CORS preflight', () => {
  it('allows every method a route handles', async () => {
    /* A browser asks before sending anything but GET or POST, and refuses
       a method the answer leaves out: the fetch throws, the route never
       runs, and no test of the route can see it. PUT was missing for the
       push subscription until 12 September, and the notifications switch
       read "not available" on every device. */
    const allowed = await allowedMethods();
    const dir = new URL('../src/routes/', import.meta.url);
    const missing = new Set<string>();
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = await readFile(new URL(name, dir), 'utf8');
      for (const [, method] of source.matchAll(/\bmethod\s*(?:===|!==)\s*'([A-Z]+)'/g)) {
        if (!allowed.includes(method)) missing.add(`${name}: ${method}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
