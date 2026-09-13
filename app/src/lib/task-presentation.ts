/* ============================================================
   What the owner reads under a reply while Jentera works.

   A step arrives as the agent's own line: `💻 terminal: "git"`,
   `🔍 web_search: "…"`, or plain narration. Arguments never reach here
   (the runner keeps only the program), and narration is never quoted,
   because older traces carried passwords and internal paths. What is
   shown is the kind of work, the program or subject when that is safe,
   and how many steps of that kind ran in a row.
   ============================================================ */

/** Presentation aliases only. These do not rename files or change download URLs. */
export function displayWorkspacePaths(text: string): string {
  return text
    .replace(/(^|[\s`("'])\/home\/sprite\/aisar\/outputs\/[0-9a-f-]{36}\//gi, '$1outputs/')
    .replace(/(^|[\s`("'])\/home\/sprite\/aisar\/(documents|outputs)\//gi, '$1$2/')
    .replace(/(^|[\s`("'])\/(?:home\/sprite|var\/lib\/aisar)(?:\/[^\s`"'<>)]*)?/g, '$1[internal computer path]');
}

export interface StepEntry {
  label: string;
  /** The program, the search, or the site: never an argument, never narration. */
  subject?: string;
  /** How many consecutive steps this line stands for. */
  count: number;
}

type Kind =
  | 'search' | 'read' | 'image' | 'process' | 'computer' | 'schedule'
  | 'memory' | 'create' | 'delegate' | 'file' | 'context' | 'work';

const LABELS: Record<Kind, { en: string; bm: string }> = {
  search: { en: 'Searching for information', bm: 'Mencari maklumat' },
  read: { en: 'Reading information', bm: 'Membaca maklumat' },
  image: { en: 'Checking an image', bm: 'Memeriksa imej' },
  process: { en: 'Checking task progress', bm: 'Menyemak kemajuan tugasan' },
  computer: { en: 'Working on Jentera’s computer', bm: 'Menjalankan tugasan pada komputer Jentera' },
  schedule: { en: 'Setting a schedule', bm: 'Menetapkan jadual' },
  memory: { en: 'Noting something down', bm: 'Mencatat sesuatu' },
  create: { en: 'Creating an image', bm: 'Mencipta imej' },
  delegate: { en: 'Handing part of the task to a specialist', bm: 'Menyerahkan sebahagian tugasan kepada pakar' },
  file: { en: 'Working on a file', bm: 'Mengusahakan fail' },
  context: { en: 'Preparing conversation context', bm: 'Menyediakan konteks perbualan' },
  work: { en: 'Working through the task', bm: 'Menjalankan tugasan' },
};

const MAX_SUBJECTS = 4;
const MAX_SUBJECT_CHARS = 80;

/** The same rule the runner applies before a command leaves the sprite,
    so an older trace that still carries a whole command shows only its
    program too. */
function programOf(command: string): string | undefined {
  for (const raw of command.trim().split(/\s+/)) {
    const token = raw.replace(/^[({]+/, '');
    if (!token) continue;
    if (/[<>|&;`$!]/.test(token)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (/^(?:sudo|env|nohup|time|exec|command)$/.test(token)) continue;
    const name = token.slice(token.lastIndexOf('/') + 1);
    if (!/^[A-Za-z0-9._+-]{1,40}$/.test(name)) return undefined;
    /* The runtime and the host are implementation details, not activity. */
    return /^(?:hermes(?:-agent)?|sprites?|flyctl|fly|wrangler)$/i.test(name) ? undefined : name;
  }
  return undefined;
}

function hostOf(text: string): string | undefined {
  try {
    return new URL(text).host || undefined;
  } catch {
    return undefined;
  }
}

/* A tool line is exactly what the worker writes: `tool: "preview"` or
   `tool...`, lowercase, after an optional emoji. Anything else is the
   agent narrating, which may hold a colon and is never quoted. */
function classify(step: string): { kind: Kind; subject?: string } {
  const quoted = step.match(/(?:^|\s)([a-z][a-z0-9_]{1,50}):\s*"([\s\S]*)"\s*$/);
  const bare = quoted ? null : step.match(/(?:^|\s)([a-z][a-z0-9_]{1,50})\.\.\.\s*$/);
  if (!quoted && !bare) {
    return { kind: /shortening conversation context/i.test(step) ? 'context' : 'work' };
  }
  const tool = (quoted ?? bare)![1];
  const preview = quoted ? quoted[2].trim() : '';

  if (tool === 'web_search') {
    return { kind: 'search', subject: displayWorkspacePaths(preview).slice(0, MAX_SUBJECT_CHARS) || undefined };
  }
  if (tool === 'web_extract' || tool.startsWith('browser_')) return { kind: 'read', subject: hostOf(preview) };
  if (tool === 'read_file' || /extract|browse/.test(tool)) return { kind: 'read' };
  if (/search/.test(tool)) return { kind: 'search' };
  if (tool === 'vision_analyze') return { kind: 'image' };
  if (tool === 'process') return { kind: 'process' };
  if (tool === 'execute_code') return { kind: 'computer' };
  if (/^(?:terminal|shell|bash)$/.test(tool)) return { kind: 'computer', subject: programOf(preview) };
  if (tool === 'cronjob') return { kind: 'schedule' };
  if (tool === 'memory') return { kind: 'memory' };
  if (tool === 'image_generate' || tool.startsWith('bfl_')) return { kind: 'create' };
  if (tool === 'delegate_task') return { kind: 'delegate' };
  if (/^(?:write_file|patch|search_files)$/.test(tool)) return { kind: 'file' };
  return { kind: 'computer' };
}

/** The list under a reply. Beginners see one line per run of the same
    kind of work; the advanced level sees every step in order. */
export function presentTaskSteps(
  steps: string[],
  lang: 'en' | 'bm',
  options: { advanced: boolean },
): StepEntry[] {
  const entries: (StepEntry & { subjects: string[] })[] = [];
  for (const step of steps) {
    const { kind, subject } = classify(step);
    const label = LABELS[kind][lang];
    const last = entries.at(-1);
    if (!options.advanced && last && last.label === label) {
      last.count += 1;
      if (subject && !last.subjects.includes(subject) && last.subjects.length < MAX_SUBJECTS) last.subjects.push(subject);
      continue;
    }
    entries.push({ label, count: 1, subjects: subject ? [subject] : [] });
  }
  return entries.map(({ label, count, subjects }) => ({
    label,
    subject: subjects.length ? subjects.join(', ') : undefined,
    count,
  }));
}
