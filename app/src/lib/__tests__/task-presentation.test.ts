import { describe, expect, it } from 'vitest';
import { displayTaskStep, displayWorkspacePaths } from '@/lib/task-presentation';

describe('user-facing runtime presentation', () => {
  it('shows verified output locations as relative paths without inventing a filesystem mount', () => {
    expect(displayWorkspacePaths('Saved `/home/sprite/aisar/outputs/11111111-1111-4111-8111-111111111111/logo.png`')).toBe('Saved `outputs/logo.png`');
    expect(displayWorkspacePaths('/home/sprite/aisar/documents/plan.md')).toBe('documents/plan.md');
    expect(displayWorkspacePaths('/home/sprite/.claude/credentials.json')).toBe('[internal computer path]');
  });
  it('does not rewrite external URLs or user-requested tool names', () => {
    const text = '[Codex](https://example.com/home/sprite/about) and Claude';
    expect(displayWorkspacePaths(text)).toBe(text);
  });
  it('keeps infrastructure, process IDs and arbitrary login values out of historical traces', () => {
    for (const step of ['terminal: "ls /home/sprite/.hermes"', 'process: "submit proc_abc private-code"', 'Hermes on Sprite: token=private-code']) {
      expect(displayTaskStep(step, 'en')).not.toMatch(/Hermes|Sprite|proc_abc|private-code|\/home/);
    }
    expect(displayTaskStep('web_search: "query"', 'bm')).toBe('Mencari maklumat');
  });
});
