import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every source file a runtime import can reach from `entry`. Type-only
    imports are skipped: they never reach the bundle. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gms)) {
      const base = resolve(dirname(file), match[1]);
      const next = [`${base}.ts`, `${base}/index.ts`, base].find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'));
      // An unresolved relative specifier is a gap in this walk, not a file the bundle really
      // lacks: silently skipping it would let a real import go unchecked by the guard below.
      if (!next) throw new Error(`sites-bundle: cannot resolve '${match[1]}' imported from ${file}`);
      visit(next);
    }
  };
  visit(entry);
  return seen;
}

describe('the sites deploy', () => {
  it('never reaches the Calendar executor or any credential code', () => {
    const files = [...reachable(resolve(SRC, 'sites/index.ts'))].map((file) => file.slice(SRC.length + 1));
    expect(files).toContain('sites/render.ts');
    expect(files.filter((file) => file === 'connections.ts' || file.startsWith('connectors/') ||
      file === 'apps/bookings/calendar-sync.ts' || file === 'apps/bookings/bookings.ts')).toEqual([]);
  });
});
