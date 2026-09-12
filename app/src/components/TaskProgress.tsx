import { useI18n } from '@/i18n/I18nProvider';
import { ElapsedSince } from '@/components/WorkSignal';

const copy = {
  en: { title: 'Working on your request', details: 'Show technical details', privacy: 'Command arguments and raw updates are hidden to protect private information.', recorded: 'Recorded activity', total: 'Total elapsed', working: 'Working through the task', waiting: 'Waiting for a running process', reading: 'Reading information', searching: 'Searching for information', image: 'Checking an image', context: 'Preparing conversation context', update: 'Agent update' },
  bm: { title: 'Sedang mengerjakan permintaan anda', details: 'Lihat butiran teknikal', privacy: 'Argumen arahan dan kemas kini mentah disembunyikan untuk melindungi maklumat peribadi.', recorded: 'Aktiviti direkodkan', total: 'Jumlah masa', working: 'Menjalankan tugasan', waiting: 'Menunggu proses yang sedang berjalan', reading: 'Membaca maklumat', searching: 'Mencari maklumat', image: 'Memeriksa imej', context: 'Menyediakan konteks perbualan', update: 'Kemas kini ejen' },
};

function toolName(step: string): string | null {
  return step.match(/(?:^|\s)([a-z][a-z0-9_]{1,50}):\s/i)?.[1]?.toLowerCase() ?? null;
}

function phase(step: string): 'working' | 'waiting' | 'reading' | 'searching' | 'image' | 'context' {
  const tool = toolName(step);
  if (tool === 'process' || /\b(?:sleep|poll)\b/i.test(step)) return 'waiting';
  if (/compress|shortening conversation context/i.test(step)) return 'context';
  if (tool === 'vision_analyze') return 'image';
  if (tool && /search/.test(tool)) return 'searching';
  if (tool && /extract|read|browse/.test(tool)) return 'reading';
  return 'working';
}

/** These are activity observations, not verified milestones. Never turn a
 * tool invocation into a success checkmark or invent an authentication URL. */
export function TaskProgress({ steps, live, since, receipt = false }: {
  steps: string[]; live: boolean; since?: number; receipt?: boolean;
}) {
  const { lang } = useI18n();
  const c = copy[lang];
  const groups = steps.reduce<Array<{ kind: ReturnType<typeof phase>; count: number }>>((out, step) => {
    const kind = phase(step);
    if (out.at(-1)?.kind === kind) out[out.length - 1].count++;
    else out.push({ kind, count: 1 });
    return out;
  }, []);
  const technical = <>
    <p className="task-progress-privacy">{c.privacy}</p>
    <ol className="task-progress-technical">
      {steps.map((step, i) => <li key={i}>{toolName(step) ?? c.update}</li>)}
    </ol>
  </>;
  if (receipt) return technical;
  return <section className="task-progress" aria-label={c.title}>
    <header><strong>{live ? c.title : c.recorded}</strong><span>{c.recorded}: {steps.length}</span></header>
    <ol className="task-progress-activities">
      {groups.slice(-3).map((group, i, shown) => {
        const current = live && i === shown.length - 1;
        return <li key={`${group.kind}-${i}`} aria-current={current ? 'step' : undefined}>
          <span className={current ? 'ask-step-dot' : 'task-progress-dot'} aria-hidden="true" />
          <span>{c[group.kind]}</span>
          {group.count > 1 && <small>×{group.count}</small>}
        </li>;
      })}
    </ol>
    {live && since && <p className="task-progress-time">{c.total} <ElapsedSince since={since} /></p>}
    <details><summary>{c.details}</summary>{technical}</details>
  </section>;
}
