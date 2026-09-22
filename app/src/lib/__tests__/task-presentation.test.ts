import { describe, expect, it } from 'vitest';
import { displayWorkspacePaths, presentTaskSteps, safeTaskProgressLabel, stepTail } from '@/lib/task-presentation';

it('accepts bounded public task labels but rejects technical details and outcome claims', () => {
  expect(safeTaskProgressLabel('Comparing the documented options')).toBe('Comparing the documented options');
  expect(safeTaskProgressLabel('Menyemak penggunaan token')).toBe('Menyemak penggunaan token');
  for (const label of ['Done', 'Approved', 'Reading /home/private', 'Checking token=secret', 'Reading https://example.com', 'Checking user@example.com', 'Checking ' + 'x'.repeat(100)]) {
    expect(safeTaskProgressLabel(label)).toBeUndefined();
  }
});

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
});

describe('the steps under a reply', () => {
  const computer = [
    '💻 terminal: "git"',
    '💻 terminal: "git"',
    '💻 terminal: "python3"',
    '🔍 web_search: "oat milk latte PJ Damansara"',
    '🌐 web_extract: "https://www.malaymail.com/news/malaysia/2026/09/13/story"',
  ];

  it('folds consecutive steps of one kind into one line that names the programs', () => {
    expect(presentTaskSteps(computer, 'en', { advanced: false })).toEqual([
      { label: 'Running a command', subject: 'git, python3', count: 3 },
      { label: 'Searching for information', subject: 'oat milk latte PJ Damansara', count: 1 },
      { label: 'Reading information', subject: 'www.malaymail.com', count: 1 },
    ]);
  });

  it('keeps every step, in order, for the advanced level', () => {
    const entries = presentTaskSteps(computer, 'en', { advanced: true });
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.subject)).toEqual(['git', 'git', 'python3', 'oat milk latte PJ Damansara', 'www.malaymail.com']);
    expect(entries.every((e) => e.count === 1)).toBe(true);
  });

  it('names the file being worked on, without the directory holding it', () => {
    const steps = [
      '\u{1F4D6} read_file: "/tmp/urs_etiket.txt"',
      '\u{1F4C1} write_file: "/home/sprite/aisar/outputs/11111111-1111-4111-8111-111111111111/summary.md"',
    ];
    expect(presentTaskSteps(steps, 'en', { advanced: true }).map((e) => e.subject))
      .toEqual(['urs_etiket.txt', 'summary.md']);
  });

  it('drops the subject when the path is the computer\'s own, rather than naming it', () => {
    const steps = [
      '\u{1F4D6} read_file: "/home/sprite/.hermes/config.yaml"',
      '\u{1F4D6} read_file: "/var/lib/aisar/browser-control.json"',
    ];
    for (const entry of presentTaskSteps(steps, 'en', { advanced: true })) {
      expect(entry.subject).toBeUndefined();
    }
  });

  it('refuses a file name that names a credential', () => {
    const [entry] = presentTaskSteps(['\u{1F4D6} read_file: "/tmp/api_key.txt"'], 'en', { advanced: true });
    expect(entry.subject).toBeUndefined();
  });

  it('shows what was searched for and folds repeats into one line', () => {
    const steps = [
      '\u{1F4C1} search_files: "^===== PAGE (1[1-9]|2[0-9])"',
      '\u{1F4C1} search_files: "etiket"',
    ];
    expect(presentTaskSteps(steps, 'en', { advanced: false })).toEqual([
      { label: 'Working on a file', subject: '^===== PAGE (1[1-9]|2[0-9]), etiket', count: 2 },
    ]);
  });

  it('shows only the program of an older raw command, never its arguments', () => {
    const [entry] = presentTaskSteps(['💻 terminal: "TOKEN=abc curl -H \\"Authorization: Bearer x\\" https://example.com/login"'], 'en', { advanced: true });
    expect(entry).toEqual({ label: 'Running a command', subject: 'curl', count: 1 });
  });

  it('names nothing for a hidden or code step, and keeps login values out of process steps', () => {
    const entries = presentTaskSteps([
      '💻 terminal: "[Command arguments hidden]"',
      '🐍 execute_code: "import urllib.request"',
      '💻 process: "submit proc_abc private-code"',
    ], 'en', { advanced: true });
    expect(entries.map((e) => e.subject)).toEqual([undefined, undefined, undefined]);
    expect(JSON.stringify(entries)).not.toMatch(/proc_abc|private-code|urllib/);
    expect(entries[2].label).toBe('Checking task progress');
  });

  it('treats narration as work, folded, with nothing quoted from it', () => {
    const entries = presentTaskSteps(['Searching for headlines', 'Hermes on Sprite: token=private-code', 'Summarising'], 'en', { advanced: false });
    expect(entries).toEqual([{ label: 'Continuing the task', subject: undefined, count: 3 }]);
  });

  it('handles the bare, empty and odd shapes a trace can hold', () => {
    expect(presentTaskSteps([], 'en', { advanced: false })).toEqual([]);
    expect(presentTaskSteps(['🔍 web_search...'], 'en', { advanced: false })).toEqual([{ label: 'Searching for information', subject: undefined, count: 1 }]);
    expect(presentTaskSteps(['terminal: "ls /home/sprite/.hermes"'], 'en', { advanced: false })).toEqual([{ label: 'Checking files and settings', subject: 'ls', count: 1 }]);
    expect(presentTaskSteps(['🌐 web_extract: "not a url"'], 'en', { advanced: false })[0].subject).toBeUndefined();
    expect(presentTaskSteps(['   '], 'en', { advanced: false })).toEqual([{ label: 'Continuing the task', subject: undefined, count: 1 }]);
  });

  it('keeps query strings, internal paths and runtime names out of subjects', () => {
    const entries = presentTaskSteps([
      '🌐 browser_navigate: "https://example.com/login?token=abc#frag"',
      '🔍 web_search: "notes in /home/sprite/aisar/documents/plan.md"',
      '💻 terminal: "/home/sprite/.hermes/bin/hermes --config x"',
      '💻 terminal: "sprite exec ls"',
    ], 'en', { advanced: true });
    expect(entries[0].subject).toBe('example.com');
    expect(entries[1].subject).toBe('notes in documents/plan.md');
    expect(entries[2].subject).toBeUndefined();
    expect(entries[3].subject).toBeUndefined();
    expect(JSON.stringify(entries)).not.toMatch(/token=abc|\/home\/sprite|hermes|Hermes|sprite exec/);
  });

  it('never takes a flag for a program', () => {
    const subjects = presentTaskSteps([
      '💻 terminal: "command -v codex"',
      '💻 terminal: "sudo -n true"',
      '💻 terminal: "-v"',
    ], 'en', { advanced: true }).map((e) => e.subject);
    expect(subjects).toEqual(['codex', 'true', undefined]);
  });

  it('bounds what one line can carry', () => {
    const programs = ['a', 'b', 'c', 'd', 'e', 'f'].map((p) => `💻 terminal: "${p}"`);
    expect(presentTaskSteps(programs, 'en', { advanced: false })).toEqual([{ label: 'Running a command', subject: 'a, b, c, d', count: 6 }]);
    const long = presentTaskSteps([`🔍 web_search: "${'x'.repeat(200)}"`], 'en', { advanced: false });
    expect(long[0].subject?.length).toBe(80);
    const twoQueries = presentTaskSteps(['🔍 web_search: "kopi"', '🔍 web_search: "kopi"', '🔍 web_search: "teh"'], 'en', { advanced: false });
    expect(twoQueries).toEqual([{ label: 'Searching for information', subject: 'kopi, teh', count: 3 }]);
  });

  it('speaks Malay too', () => {
    expect(presentTaskSteps(['💻 terminal: "git"', '🔍 web_search: "kopi"'], 'bm', { advanced: false }).map((e) => e.label))
      .toEqual(['Menjalankan arahan', 'Mencari maklumat']);
  });
});

describe('stepTail', () => {
  const entries = ['a', 'b', 'c', 'd'].map(label => ({ label, count: 1 }));

  it('keeps a short trail whole', () => {
    expect(stepTail(entries, 6, false)).toEqual({ shown: entries, hidden: 0 });
  });

  it('keeps the end of a long trail, which is what led to the answer', () => {
    const { shown, hidden } = stepTail(entries, 2, false);
    expect(shown.map(entry => entry.label)).toEqual(['c', 'd']);
    expect(hidden).toBe(2);
  });

  it('shows everything once the earlier steps are asked for', () => {
    expect(stepTail(entries, 2, true)).toEqual({ shown: entries, hidden: 0 });
  });
});
