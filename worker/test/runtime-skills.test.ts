import { describe, expect, it } from 'vitest';
import { runtimeSkillList } from '../src/routes/runtime';
import { selectedSkillIds } from '../src/routes/runs';

describe('runtime skill boundary', () => {
  it('keeps only bounded public metadata and removes duplicates', () => {
    expect(runtimeSkillList([
      { id: 'market-scan', name: 'Market scan', description: 'Compare\npublic sources', category: 'research', disabled: false, path: '/secret', content: 'private' },
      { id: 'market-scan', name: 'market scan', description: 'duplicate' },
      { name: '', description: 'missing' },
      null,
    ])).toEqual([{
      id: 'market-scan',
      name: 'Market scan',
      description: 'Compare public sources',
      category: 'research',
      disabled: false,
    }]);
  });

  it('accepts only five unique command-safe skill ids', () => {
    expect(selectedSkillIds(undefined)).toEqual([]);
    expect(selectedSkillIds(['market-scan', 'pdf'])).toEqual(['market-scan', 'pdf']);
    expect(selectedSkillIds(['market-scan', 'market-scan'])).toBeNull();
    expect(selectedSkillIds(['one', 'two', 'three', 'four', 'five', 'six'])).toBeNull();
    expect(selectedSkillIds(['../private'])).toBeNull();
    expect(selectedSkillIds('market-scan')).toBeNull();
  });
});
