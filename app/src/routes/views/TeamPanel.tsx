/* ============================================================
   The team tab: who is in this business, who has been invited, and the
   one form that invites the next person. Team is a plan, so the tab is
   only mounted where the server has said it applies; the routes check
   again on every write.
   ============================================================ */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { Button, Card, Input, LoadingState, Tag } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { Team } from '@/lib/repo';
import WorkspacesPanel from './WorkspacesPanel';

export default function TeamPanel() {
  const t = useT();
  const toast = useToast();
  const repo = useRepository();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!repo.team) return;
    setError(false);
    try {
      setTeam(await repo.team());
    } catch {
      setError(true);
    }
  }, [repo]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!repo.inviteTeamMember || !email.trim()) return;
    setBusy(true);
    try {
      const invitation = await repo.inviteTeamMember(email.trim());
      setTeam((prev) => prev ? { ...prev, invitations: [...prev.invitations, invitation] } : prev);
      setEmail('');
      toast(t('team.invite.sent', { email: invitation.email }));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('team.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!repo.revokeTeamInvitation) return;
    try {
      await repo.revokeTeamInvitation(id);
      setTeam((prev) => prev ? { ...prev, invitations: prev.invitations.filter((i) => i.id !== id) } : prev);
      toast(t('team.revoked'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('team.error'), 'error');
    }
  }

  if (error) {
    return (
      <Card role="alert" className="gap-3">
        <p className="text-sm">{t('team.error')}</p>
        <div><Button variant="outline" onClick={() => void load()}>{t('loading.retry')}</Button></div>
      </Card>
    );
  }
  if (!team) return <Card><LoadingState title={t('team.loading')} /></Card>;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3">
        <div className="workspace-section-heading">
          <div>
            <h3>{t('team.title')}</h3>
            <p className="text-[13px] text-text-secondary">{t('team.intro')}</p>
          </div>
        </div>
        <h4 className="m-0 text-[13px] font-medium">{t('team.members')}</h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('team.members')}>
          {team.members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-item border border-border px-3 py-2">
              <span className="min-w-0 truncate text-[13px]">
                {member.email}
                {member.you && <span className="ml-2 text-text-muted">· {t('team.you')}</span>}
              </span>
              <Tag tone={member.role === 'owner' ? 'green' : 'neutral'}>{t(`team.role.${member.role}`)}</Tag>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="gap-3">
        <h4 className="m-0 text-[13px] font-medium">{t('team.invitations')}</h4>
        {team.invitations.length === 0
          ? <p className="text-[13px] text-text-secondary">{t('team.invitations.none')}</p>
          : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('team.invitations')}>
              {team.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-item border border-border px-3 py-2">
                  <span className="min-w-0 truncate text-[13px]">
                    {invitation.email}
                    <span className="ml-2 text-text-muted">
                      · {t('team.expires', { date: new Date(invitation.expiresAt).toLocaleDateString() })}
                    </span>
                  </span>
                  {team.canManage && repo.revokeTeamInvitation && (
                    <Button variant="outline" onClick={() => void revoke(invitation.id)} aria-label={`${t('team.revoke')} ${invitation.email}`}>
                      {t('team.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        {team.canManage && repo.inviteTeamMember && (
          <form className="flex flex-col gap-2" onSubmit={(event) => void invite(event)}>
            <label className="text-[13px] font-medium" htmlFor="team-invite-email">{t('team.invite.label')}</label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="team-invite-email"
                type="email"
                required
                value={email}
                placeholder={t('team.invite.placeholder')}
                onChange={(event) => setEmail(event.target.value)}
                className="min-w-[16rem] flex-1"
              />
              <Button type="submit" disabled={busy}>
                <PaperPlaneTilt size={16} aria-hidden="true" />
                {t(busy ? 'team.invite.sending' : 'team.invite.button')}
              </Button>
            </div>
            <p className="text-[12px] text-text-muted">{t('team.invite.note')}</p>
          </form>
        )}
      </Card>

      <WorkspacesPanel members={team.members} />
    </div>
  );
}
