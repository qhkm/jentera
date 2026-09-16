import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/repo';
import { firstWorkflowTask, workflowTaskKey } from '@/lib/first-workflow';

beforeEach(() => localStorage.clear());
describe('confirmed first-workflow brief', () => {
  it('ignores unconfirmed proposed work', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: workflowTaskKey, value: 'Agent-proposed task', source: 'agent' });
    expect(firstWorkflowTask(await repo.load())).toBe('');
  });
  it('uses the last confirmed task while a replacement awaits review', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: workflowTaskKey, value: 'Owner-approved task', source: 'owner' });
    await repo.setFact({ key: workflowTaskKey, value: 'Unconfirmed replacement', source: 'agent' });
    expect(firstWorkflowTask(await repo.load())).toBe('Owner-approved task');
  });
  it('ignores invalid values rather than truncating a different task into a brief', async () => {
    const repo = new LocalRepository();
    for (const value of [null, { task: 'not a string' }, 'x'.repeat(2001), '   ']) {
      await repo.setFact({ key: workflowTaskKey, value, source: 'owner' });
      expect(firstWorkflowTask(await repo.load())).toBe('');
    }
  });
});
