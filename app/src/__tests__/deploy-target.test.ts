import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The Jentera app publishes to the aisar-jentera Pages project through the
   root deploy.sh, which also verifies the served bundle. A package script
   that names a project directly can publish this app over the separate apex
   site; it happened to be pointed at exactly that. */
describe('the app deploy script', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('routes through the root deploy script instead of naming a Pages project', () => {
    expect(pkg.scripts.deploy).toMatch(/deploy\.sh/);
    expect(pkg.scripts.deploy).not.toMatch(/--project-name/);
  });
});
