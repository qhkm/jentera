import { describe, expect, it } from 'vitest';
import { setupStageReporter } from '../src/runtime/setup-progress';
describe('bootstrap stage reporting', () => {
  it('accepts split markers, suppresses logs, duplicates and regressing stages', async () => {
    const stages: string[] = [];
    const report = setupStageReporter(async stage => { stages.push(stage); });
    await report('\u0001JENTERA_SETUP_STA');
    await report('GE:install\nsecret diagnostic\nJENTERA_SETUP_STAGE:npm\n');
    await report('JENTERA_SETUP_STAGE:npm\nJENTERA_SETUP_STAGE:install\nJENTERA_SETUP_STAGE:unknown\n');
    await report('JENTERA_SETUP_STAGE:checks\n');
    expect(stages).toEqual(['install', 'npm', 'checks']);
  });
});
