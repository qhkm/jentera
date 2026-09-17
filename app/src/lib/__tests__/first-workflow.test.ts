import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/repo';
import { firstWorkflowBrief, firstWorkflowTask, workflowBriefKey, workflowTaskKey } from '@/lib/first-workflow';

beforeEach(() => localStorage.clear());
describe('confirmed first-workflow brief', () => {
  it('restores only a valid confirmed saved brief from the current repository', async () => {
    const repo = new LocalRepository();
    await repo.setFact({ key: workflowBriefKey, value: 'Unconfirmed instructions', source: 'agent' });
    expect(firstWorkflowBrief(await repo.load())).toBe('');
    await repo.setFact({ key: workflowBriefKey, value: ' My saved instructions ', source: 'owner' });
    expect(firstWorkflowBrief(await repo.load())).toBe('My saved instructions');
    for (const value of [null, { task: 'invalid' }, 'x'.repeat(6001)]) {
      await repo.setFact({ key: workflowBriefKey, value, source: 'owner' });
      expect(firstWorkflowBrief(await repo.load())).toBe('');
    }
  });
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
