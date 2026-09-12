import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, type Permission } from '../src/permissions';

const permissions = Object.keys(PERMISSIONS) as Permission[];

describe('who may do what', () => {
  it('grants every permission to the owner and none to staff or to nobody', () => {
    for (const permission of permissions) {
      expect(can({ role: 'owner' }, permission)).toBe(true);
      expect(can({ role: 'staff' }, permission)).toBe(false);
      expect(can({ role: null }, permission)).toBe(false);
    }
  });

  it('is the only place a route decides by role', async () => {
    /* A hand-written role check at a call site is what this table
       replaces; one that comes back is a third role's fifteenth edit. */
    const dir = new URL('../src/routes/', import.meta.url);
    const offenders: string[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = await readFile(new URL(name, dir), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (/\.role\s*(!==|===)\s*'(owner|staff)'/.test(line)) offenders.push(`${name}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
