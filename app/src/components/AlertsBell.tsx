import { Bell } from '@phosphor-icons/react';
import { useT } from '@/i18n/I18nProvider';
import { useHomeApps } from '@/lib/apps/useApps';

/** Alerts' entrance once Home shows apps in its place (option B). Absent
    otherwise, so there are never two ways in. */
export function AlertsBell({ unread, onOpen }: { unread: number; onOpen: () => void }) {
  const t = useT();
  if (!useHomeApps()) return null;
  return <button type="button" className="workspace-bell" onClick={onOpen}
    aria-label={unread > 0 ? t('home.bell.unread', { n: unread }) : t('home.bell')}>
    <Bell size={19} weight="duotone" aria-hidden="true" />
    {unread > 0 && <span className="workspace-bell-count" aria-hidden="true">{unread}</span>}
  </button>;
}
