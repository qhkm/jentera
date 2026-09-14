import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function corsMethods(): Promise<string[]> {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const match = source.match(/'Access-Control-Allow-Methods':\s*'([A-Z,]+)'/);
  if (!match) throw new Error('index.ts no longer states Access-Control-Allow-Methods');
  return match[1].split(',');
}

async function guardMethods(): Promise<{ accepted: string[]; allowHeader: string[] }> {
  const source = await readFile(new URL('../src/request-guard.ts', import.meta.url), 'utf8');
  const list = source.match(/!\[((?:'[A-Z]+',?\s*)+)\]\.includes\(request\.method\)/);
  const allow = source.match(/Allow:\s*'([A-Z, ]+)'/);
  if (!list || !allow) throw new Error('request-guard.ts no longer states its method allowlist');
  return {
    accepted: [...list[1].matchAll(/'([A-Z]+)'/g)].map((m) => m[1]),
    allowHeader: allow[1].split(',').map((m) => m.trim()),
  };
}

/** Every method a route compares against, by file. */
async function routeMethods(): Promise<Map<string, Set<string>>> {
  const dir = new URL('../src/routes/', import.meta.url);
  const found = new Map<string, Set<string>>();
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.ts')) continue;
    const source = await readFile(new URL(name, dir), 'utf8');
    for (const [, method] of source.matchAll(/\bmethod\s*(?:===|!==)\s*'([A-Z]+)'/g)) {
      if (!found.has(name)) found.set(name, new Set());
      found.get(name)!.add(method);
    }
  }
  return found;
}

function leftOut(routes: Map<string, Set<string>>, allowed: string[]): string[] {
  const missing: string[] = [];
  for (const [name, methods] of routes) {
    for (const method of methods) if (!allowed.includes(method)) missing.push(`${name}: ${method}`);
  }
  return missing;
}

/* A route's method has to pass two lists before the route runs, and no
   test of the route can see either: the browser's preflight refuses a
   method the CORS answer leaves out (the fetch throws), and the pre-route
   guard answers 405 to one its allowlist leaves out. PUT was missing from
   both for the push subscription until 12 September, and the notifications
   switch read "not available" on every device while the route's own tests
   passed. */
describe('a method a route handles', () => {
  it('is in the CORS preflight answer', async () => {
    expect(leftOut(await routeMethods(), await corsMethods())).toEqual([]);
  });

  it('passes the pre-route guard, and its Allow header says so', async () => {
    const guard = await guardMethods();
    const routes = await routeMethods();
    expect(leftOut(routes, guard.accepted)).toEqual([]);
    expect(leftOut(routes, guard.allowHeader)).toEqual([]);
  });
});

async function corsAllowHeaders(): Promise<string[]> {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const match = source.match(/'Access-Control-Allow-Headers':\s*'([A-Za-z0-9,\- ]+)'/);
  if (!match) throw new Error('index.ts no longer states Access-Control-Allow-Headers');
  return match[1].split(',').map((name) => name.trim().toLowerCase());
}

/** Every custom request header the client sends, by name. */
async function clientHeaders(): Promise<string[]> {
  const source = await readFile(
    new URL('../../app/src/lib/repo/remote.ts', import.meta.url), 'utf8');
  return [...new Set([...source.matchAll(/'(X-[A-Za-z0-9-]+)':/g)].map((m) => m[1]))];
}

/* A custom request header has to be named in the CORS answer or the
   browser's preflight refuses the request outright, and no test of the
   route can see it: curl sends the header happily and the route's own
   tests call the handler directly. X-Aisar-File-Name was missing from
   13 September, so document upload had never once worked from
   jentera.ai while its route tests passed. */
describe('a custom request header the client sends', () => {
  it('is named in the CORS preflight answer', async () => {
    const allowed = await corsAllowHeaders();
    const missing = (await clientHeaders()).filter((name) => !allowed.includes(name.toLowerCase()));
    expect(missing).toEqual([]);
  });
});
