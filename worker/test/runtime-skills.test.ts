import { describe, expect, it } from 'vitest';
import { runtimeSkillList } from '../src/routes/runtime';

describe('runtime skill boundary', () => {
  it('keeps only bounded public metadata and removes duplicates', () => {
    expect(runtimeSkillList([
      { name: 'Market scan', description: 'Compare\npublic sources', category: 'research', disabled: false, path: '/secret', content: 'private' },
      { name: 'market scan', description: 'duplicate' },
      { name: '', description: 'missing' },
      null,
    ])).toEqual([{
      name: 'Market scan',
      description: 'Compare public sources',
      category: 'research',
      disabled: false,
    }]);
  });
});
