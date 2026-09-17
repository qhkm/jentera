import { useI18n } from '@/i18n/I18nProvider';
import type { RuntimeOverview } from '@/lib/repo';

const stages = ['preparing', 'downloads', 'install', 'npm', 'browser', 'configure', 'checks', 'checkpoint'];
const en = ['Preparing your computer', 'Getting setup files', 'Installing the workspace', 'Installing apps', 'Preparing the browser', 'Connecting your tools', 'Checking everything works', 'Saving the ready computer'];
const bm = ['Menyediakan komputer anda', 'Mendapatkan fail persediaan', 'Memasang ruang kerja', 'Memasang aplikasi', 'Menyediakan pelayar', 'Menyambungkan alatan anda', 'Menyemak semuanya berfungsi', 'Menyimpan komputer yang sedia'];
// Broad initial ranges, not promises or a timer-driven progress percentage.
const minutes = [[3, 10], [3, 10], [2, 8], [2, 6], [1, 4], [1, 3], [1, 2], [1, 2]];
export function ComputerSetupProgress({ progress, now = Date.now(), compact = false }: { progress: NonNullable<RuntimeOverview['setupProgress']>; now?: number; compact?: boolean }) {
  const { lang } = useI18n();
  const index = stages.indexOf(progress.stage);
  if (index < 0 || !Number.isFinite(Date.parse(progress.updatedAt))) return null;
  const percent = Math.round(index / stages.length * 100);
  const [low, high] = minutes[index];
  const stalled = now - Date.parse(progress.updatedAt) > high * 60_000;
  const label = (lang === 'bm' ? bm : en)[index];
  if (compact) return <div className="computer-setup-inline" title={label}>
    <span>{label}</span>
    <progress max={100} value={percent} aria-label={lang === 'bm' ? 'Kemajuan persediaan anggaran' : 'Approximate setup progress'} />
    <small>~{percent}%</small>
  </div>;
  return <div className="computer-setup-progress">
    <div className="computer-setup-stage"><strong>{label}</strong><span>~{percent}%</span></div>
    <progress max={100} value={percent} aria-label={lang === 'bm' ? 'Kemajuan persediaan anggaran' : 'Approximate setup progress'} />
    <p>{stalled ? (lang === 'bm' ? 'Mengambil masa lebih lama daripada jangkaan. Menunggu kemas kini langkah seterusnya.' : 'Taking longer than expected. Waiting for the next stage update.')
      : lang === 'bm' ? `Anggaran awal: ${low}–${high} minit lagi.` : `Rough estimate: ${low}–${high} minutes left.`}</p>
    <small>{lang === 'bm' ? 'Kemajuan berdasarkan langkah yang disahkan.' : 'Progress reflects confirmed setup stages.'}</small>
  </div>;
}
