import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
    const specifiers = [
      // import { a } from './x'; export * from './x' — but not `import type`.
      ...text.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gms),
      // import './x' — a side-effect import still puts the module in the bundle.
      ...text.matchAll(/^import\s+['"](\.{1,2}\/[^'"]+)['"]/gm),
      // import('./x') — a dynamic import is bundled too.
      ...text.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const base = resolve(dirname(file), specifier);
      const next = [`${base}.ts`, `${base}/index.ts`, base].find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'));
      // An unresolved relative specifier is a gap in this walk, not a file the bundle really
      // lacks: silently skipping it would let a real import go unchecked by the guard below.
      if (!next) throw new Error(`sites-bundle: cannot resolve '${specifier}' imported from ${file}`);
      visit(next);
    }
  };
  visit(entry);
  return seen;
}

describe('the import walk', () => {
  it('follows side-effect and dynamic relative imports, and skips type-only ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sites-bundle-'));
    try {
      writeFileSync(join(dir, 'entry.ts'), [
        "import './side';",
        "import type { T } from './types';",
        "export async function later() { return import('./lazy'); }",
        "import { value } from './named';",
        'export const x = value;',
      ].join('\n'));
      for (const name of ['side', 'types', 'lazy', 'named']) writeFileSync(join(dir, `${name}.ts`), 'export const value = 1;\n');
      const files = [...reachable(join(dir, 'entry.ts'))].map((file) => file.slice(dir.length + 1)).sort();
      expect(files).toEqual(['entry.ts', 'lazy.ts', 'named.ts', 'side.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the sites deploy', () => {
  it('never reaches the Calendar executor or any credential code', () => {
    const files = [...reachable(resolve(SRC, 'sites/index.ts'))].map((file) => file.slice(SRC.length + 1));
    expect(files).toContain('sites/render.ts');
    expect(files.filter((file) => file === 'connections.ts' || file.startsWith('connectors/') ||
      file === 'apps/bookings/calendar-sync.ts' || file === 'apps/bookings/bookings.ts')).toEqual([]);
  });
});
