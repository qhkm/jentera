import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tests run from app/; jsdom rewrites import.meta.url to an HTTP URL.
const root = resolve(process.cwd(), '..');
function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    // Test fixtures are not part of the product source graph.
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(join(path, entry.name));
    return /\.(?:ts|tsx|css|sql)$/.test(entry.name) ? [join(path, entry.name)] : [];
  });
}

/** Deliberately replace this launch-only boundary when approving the future pilot. */
describe('launch excludes the deferred external report pilot', () => {
  it('has no app or Worker feature imports, discovery, handlers or report kinds', () => {
    const files = [...sourceFiles(join(root, 'app/src')), ...sourceFiles(join(root, 'worker/src'))];
    const forbidden = /external[-_]triggers|ExternalTriggers|EXTERNAL_TRIGGERS|external_report|external\.report/;
    expect(files.filter(path => forbidden.test(readFileSync(path, 'utf8')))).toEqual([]);
  });
  it('does not apply the trigger schema or expose its migration/enablement commands', () => {
    const migrationDir = join(root, 'worker/migrations');
    const migrations = readdirSync(migrationDir).filter(name => name.endsWith('.sql'));
    expect(migrations.filter(name => /^051_|external[-_]triggers/.test(name))).toEqual([]);
    expect(migrations.filter(name => /external_trigger/.test(readFileSync(join(migrationDir, name), 'utf8')))).toEqual([]);
    for (const path of ['worker/package.json', 'worker/wrangler.toml']) {
      expect(readFileSync(join(root, path), 'utf8')).not.toMatch(/external-triggers|EXTERNAL_TRIGGERS/);
    }
  });
});
