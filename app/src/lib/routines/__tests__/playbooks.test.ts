import { describe, expect, it } from 'vitest';
import { AUTOMATION_PLAYBOOKS, playbookConfig } from '../playbooks';
describe('automation playbook configuration', () => {
  it('keeps runnable playbooks within supported routine tasks and prompt limits', () => {
    for (const playbook of AUTOMATION_PLAYBOOKS.filter(p => p.available)) {
      const config = playbookConfig(playbook, 'x'.repeat(800));
      expect(config.delivery).toBe('workspace');
      expect(config.schedule.timeZone).toBe('Asia/Kuala_Lumpur');
      if (config.task.kind === 'agent_task') {
        expect(config.task.prompt.length).toBeLessThanOrEqual(2000);
        expect(config.task.prompt).toContain('Do not send messages');
      }
    }
  });
  it('refuses unavailable playbooks and empty research briefs', () => {
    expect(() => playbookConfig(AUTOMATION_PLAYBOOKS.find(p => p.id === 'lead-followup')!, 'test')).toThrow(/integrations/);
    expect(() => playbookConfig(AUTOMATION_PLAYBOOKS.find(p => p.id === 'research-brief')!, ' ')).toThrow(/brief/);
  });
});
