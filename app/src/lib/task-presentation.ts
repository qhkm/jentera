/* ============================================================
   What the owner reads under a reply while Jentera works.

   A step arrives as the agent's own line: `💻 terminal: "git"`,
   `🔍 web_search: "…"`, or plain narration. A command's arguments never
   reach here (the runner keeps only the program) and narration is never
   quoted, because older traces carried passwords and internal paths. What is
   shown is the kind of work, a subject when that subject is safe — the
   program, the search, the site, or a file's name without its directory —
   and how many steps of that kind ran in a row.

   A file's name is the owner's own material, so it is shown; the directory
   it sits in is the computer's business and is not. A path that resolves to
   somewhere internal loses its subject entirely rather than naming it.
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
  /** The specialist who took this step, when it was not the lead role. */
  agent?: string;
}

/* The worker tags a specialist's step as `⟦Name⟧ <tool line>`
   (worker/src/handoff.ts agentStep); everything else is the lead role's. */
const AGENT_STEP = /^⟦([^⟦⟧\r\n]{1,60})⟧ ([\s\S]*)$/;

export function splitAgentStep(step: string): { agent?: string; step: string } {
  const match = AGENT_STEP.exec(step);
  return match ? { agent: match[1], step: match[2] } : { step };
}

/** Only explicit progress events may supply a label. Reject technical/private
 * material and outcome claims; execution events alone own task status. */
export function safeTaskProgressLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label || label.length > 100 || /[<>`{}\[\]@=\\/]|https?:|\b(?:password|token|secret|credential|api.?key|hermes|sprite)\s*[:=]/i.test(label)) return undefined;
  if (!/^(?:Checking|Reading|Researching|Comparing|Preparing|Drafting|Creating|Generating|Installing|Updating|Organizing|Organising|Reviewing|Finding|Searching|Testing|Connecting|Continuing|Menyemak|Membaca|Mengkaji|Membandingkan|Menyediakan|Mencipta|Menjana|Memasang|Mengemas kini|Menyusun|Mencari|Menguji|Menyambung|Meneruskan)\b/i.test(label)) return undefined;
  return label;
}

type Kind =
  | 'search' | 'read' | 'image' | 'process' | 'computer' | 'schedule'
  | 'memory' | 'create' | 'delegate' | 'handoff' | 'file' | 'context' | 'work' | 'research' | 'inspect' | 'command' | 'code';

const LABELS: Record<Kind, { en: string; bm: string }> = {
  search: { en: 'Searching for information', bm: 'Mencari maklumat' },
  read: { en: 'Reading information', bm: 'Membaca maklumat' },
  image: { en: 'Checking an image', bm: 'Memeriksa imej' },
  process: { en: 'Checking task progress', bm: 'Menyemak kemajuan tugasan' },
  computer: { en: 'Working on Jentera’s computer', bm: 'Menjalankan tugasan pada komputer Jentera' },
  command: { en: 'Running a command', bm: 'Menjalankan arahan' },
  code: { en: 'Running code', bm: 'Menjalankan kod' },
  schedule: { en: 'Setting a schedule', bm: 'Menetapkan jadual' },
  memory: { en: 'Noting something down', bm: 'Mencatat sesuatu' },
  create: { en: 'Creating an image', bm: 'Mencipta imej' },
  delegate: { en: 'Getting a helper to work on part of the task', bm: 'Meminta pembantu menguruskan sebahagian tugasan' },
  handoff: { en: 'Asking a specialist for help', bm: 'Meminta bantuan pakar' },
  file: { en: 'Working on a file', bm: 'Mengusahakan fail' },
  context: { en: 'Preparing conversation context', bm: 'Menyediakan konteks perbualan' },
  work: { en: 'Continuing the task', bm: 'Meneruskan tugasan' },
  research: { en: 'Continuing research', bm: 'Meneruskan penyelidikan' },
  inspect: { en: 'Checking files and settings', bm: 'Menyemak fail dan tetapan' },
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
    if (token.startsWith('-')) continue;                 // a flag of a skipped wrapper, never a program
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (/^(?:sudo|env|nohup|time|exec|command)$/.test(token)) continue;
    const name = token.slice(token.lastIndexOf('/') + 1);
    if (!/^[A-Za-z0-9._+-]{1,40}$/.test(name)) return undefined;
    /* The runtime and the host are implementation details, not activity. */
    return /^(?:hermes(?:-agent)?|sprites?|flyctl|fly|wrangler)$/i.test(name) ? undefined : name;
  }
  return undefined;
}

/** Anything naming a credential is not a subject, whatever it is attached to. */
const SECRETISH = /password|token|secret|credential|api.?key|bearer/i;

/** A file's name without the directory that holds it. The owner knows their
    own documents by name; the sprite's layout is not theirs to read, so an
    internal path drops the subject rather than showing where it lives. */
function fileNameOf(preview: string): string | undefined {
  const first = displayWorkspacePaths(preview.trim().split(/\s+/)[0] ?? '');
  if (!first || first.includes('[internal computer path]')) return undefined;
  const name = first.slice(first.lastIndexOf('/') + 1).trim();
  if (!name || name.length > MAX_SUBJECT_CHARS) return undefined;
  if (/["'`<>|&;$\\=]/.test(name) || name.startsWith('-') || SECRETISH.test(name)) return undefined;
  return name;
}

/** What was searched for, as typed. Bounded and never a credential. */
function patternOf(preview: string): string | undefined {
  const value = displayWorkspacePaths(preview).replace(/\s+/g, ' ').trim();
  if (!value || SECRETISH.test(value)) return undefined;
  return value.slice(0, MAX_SUBJECT_CHARS);
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
  if (tool === 'read_file') return { kind: 'read', subject: fileNameOf(preview) };
  if (/extract|browse/.test(tool)) return { kind: 'read' };
  if (tool === 'search_files') return { kind: 'file', subject: patternOf(preview) };
  if (/search/.test(tool)) return { kind: 'search' };
  if (tool === 'vision_analyze') return { kind: 'image' };
  if (tool === 'process') return { kind: 'process' };
  if (tool === 'execute_code') return { kind: 'code' };
  if (/^(?:terminal|shell|bash)$/.test(tool)) {
    const program = programOf(preview);
    return { kind: program && /^(?:ls|cat|head|tail|stat|find|rg|grep)$/.test(program) ? 'inspect' : 'command', subject: program };
  }
  if (tool === 'cronjob') return { kind: 'schedule' };
  if (tool === 'memory') return { kind: 'memory' };
  if (tool === 'image_generate' || tool.startsWith('bfl_')) return { kind: 'create' };
  if (tool === 'delegate_task') return { kind: 'delegate' };
  if (tool === 'ask_specialist') return { kind: 'handoff' };
  if (/^(?:write_file|patch)$/.test(tool)) return { kind: 'file', subject: fileNameOf(preview) };
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
  let researching = false;
  for (const raw of steps) {
    const { agent, step } = splitAgentStep(raw);
    let { kind, subject } = classify(step);
    // Infer only the broad ongoing activity from observed tools, never quote
    // narration or invent a phase such as comparing/preparing recommendations.
    if (kind === 'work' && researching) kind = 'research';
    if (kind === 'search' || kind === 'read') researching = true;
    else if (kind !== 'research' && kind !== 'work' && kind !== 'process') researching = false;
    const label = LABELS[kind][lang];
    const last = entries.at(-1);
    if (!options.advanced && last && last.label === label && last.agent === agent) {
      last.count += 1;
      if (subject && !last.subjects.includes(subject) && last.subjects.length < MAX_SUBJECTS) last.subjects.push(subject);
      continue;
    }
    entries.push({ label, count: 1, subjects: subject ? [subject] : [], ...(agent ? { agent } : {}) });
  }
  return entries.map(({ label, count, subjects, agent }) => ({
    label,
    subject: subjects.length ? subjects.join(', ') : undefined,
    count,
    ...(agent ? { agent } : {}),
  }));
}

/** How many lines of the trail show before the rest waits behind a button.
    Enough to read what happened at a glance; short enough that the answer
    itself is still the first thing on the screen. */
export const INLINE_STEPS = 6;

/** The end of the list, which is where the work is. Shown inline under a
    reply, a long run would otherwise push the answer off the screen, so the
    earlier lines wait behind a button rather than being dropped. */
export function stepTail(
  entries: StepEntry[],
  limit: number,
  expanded: boolean,
): { shown: StepEntry[]; hidden: number } {
  if (expanded || entries.length <= limit) return { shown: entries, hidden: 0 };
  return { shown: entries.slice(entries.length - limit), hidden: entries.length - limit };
}
