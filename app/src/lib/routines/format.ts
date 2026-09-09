import type { Lang } from '@/lib/types';
import type { Vars } from '@/i18n/I18nProvider';
import { ROUTINE_ZONE, type RoutineKind, type RoutineSchedule } from './types';

export type RoutineTranslate = (key: string, vars?: Vars) => string;

export function routineDate(instant: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    timeZone: ROUTINE_ZONE, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(instant));
}

export function scheduleLabel(schedule: RoutineSchedule, lang: Lang, t: RoutineTranslate): string {
  // Format only the selected wall-clock time. The next trigger comes from the server.
  const time = new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    timeZone: ROUTINE_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(`2000-01-01T${schedule.time}:00+08:00`));
  return t(`routines.schedule.${schedule.frequency}`, {
    time, day: schedule.frequency === 'weekly' ? t(`routines.day.${schedule.weekday}`) : '',
  });
}

export function starterSchedule(kind: RoutineKind): RoutineSchedule {
  return kind === 'weekly_summary'
    ? { frequency: 'weekly', weekday: 5, time: '17:00', timeZone: ROUTINE_ZONE }
    : { frequency: 'weekdays', time: kind === 'business_summary' ? '08:00' : '17:00', timeZone: ROUTINE_ZONE };
}

export function occurrenceStatus(status: string): string {
  return ['queued', 'working', 'needs_approval', 'completed', 'failed', 'cancelled', 'skipped'].includes(status)
    ? `routines.status.${status}` : 'routines.status.unknown';
}

export function occurrenceReason(reason: string | null): string | null {
  if (reason === null) return null;
  return ['nothing_pending', 'missed_window', 'previous_run_active', 'budget_exceeded', 'runtime_unavailable', 'permission_revoked'].includes(reason)
    ? `routines.reason.${reason}` : 'routines.reason.unknown';
}
