/* ============================================================
   Workspaces, on the Team tab: the shared spaces of this business, who is
   in each, and the form that makes another. Owner-only to change; every
   member sees the ones they are in. Team is a plan, so this mounts only
   where the server has said it applies.
   ============================================================ */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Input, LoadingState, Tag } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { TeamMember, Workspaces } from '@/lib/repo';

export default function WorkspacesPanel({ members }: { members: TeamMember[] }) {
  const t = useT();
  const toast = useToast();
  const repo = useRepository();
  const [data, setData] = useState<Workspaces | null>(null);
  const [error, setError] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!repo.workspaces) return;
    setError(false);
    try {
      setData(await repo.workspaces());
    } catch {
      setError(true);
    }
  }, [repo]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!repo.createWorkspace || !name.trim()) return;
    setBusy(true);
    try {
      const workspace = await repo.createWorkspace(name.trim(), picked);
      setData((prev) => prev ? { ...prev, workspaces: [...prev.workspaces, workspace] } : prev);
      setName('');
      setPicked([]);
      toast(t('ws.created', { name: workspace.name }));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('ws.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function add(workspaceId: string) {
    const userId = adding[workspaceId];
    if (!repo.addWorkspaceMember || !userId) return;
    try {
      await repo.addWorkspaceMember(workspaceId, userId);
      setAdding((prev) => ({ ...prev, [workspaceId]: '' }));
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('ws.error'), 'error');
    }
  }

  async function remove(workspaceId: string, userId: string, workspaceName: string) {
    if (!repo.removeWorkspaceMember) return;
    try {
      await repo.removeWorkspaceMember(workspaceId, userId);
      toast(t('ws.removed', { name: workspaceName }));
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('ws.error'), 'error');
    }
  }

  if (error) {
    return (
      <Card role="alert" className="gap-3">
        <p className="text-sm">{t('ws.error')}</p>
        <div><Button variant="outline" onClick={() => void load()}>{t('loading.retry')}</Button></div>
      </Card>
    );
  }
  if (!data) return <Card><LoadingState title={t('team.loading')} /></Card>;

  return (
    <Card className="gap-3">
      <div className="workspace-section-heading">
        <div>
          <h3>{t('ws.title')}</h3>
          <p className="text-[13px] text-text-secondary">{t('ws.intro')}</p>
        </div>
      </div>
      {data.workspaces.length === 0
        ? <p className="text-[13px] text-text-secondary">{t('ws.none')}</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('ws.title')}>
            {data.workspaces.map((workspace) => {
              const outside = members.filter((m) => !workspace.members.some((w) => w.userId === m.userId));
              return (
                <li key={workspace.id} className="flex flex-col gap-2 rounded-item border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[14px]">{workspace.name}</strong>
                    {!workspace.member && <Tag>{t('ws.notMember')}</Tag>}
                  </div>
                  <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={`${workspace.name} · ${t('ws.members')}`}>
                    {workspace.members.map((member) => (
                      <li key={member.userId} className="flex items-center gap-1 rounded-item border border-border px-2 py-1 text-[12px]">
                        <span>{member.email}{member.you ? ` · ${t('team.you')}` : ''}</span>
                        {data.canManage && repo.removeWorkspaceMember && (
                          <button
                            type="button"
                            className="ask-inline-action"
                            aria-label={t('ws.remove', { email: member.email, name: workspace.name })}
                            onClick={() => void remove(workspace.id, member.userId, workspace.name)}
                          >×</button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {data.canManage && repo.addWorkspaceMember && outside.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="input"
                        aria-label={t('ws.add.label', { name: workspace.name })}
                        value={adding[workspace.id] ?? ''}
                        onChange={(event) => setAdding((prev) => ({ ...prev, [workspace.id]: event.target.value }))}
                      >
                        <option value="">—</option>
                        {outside.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}
                      </select>
                      <Button variant="outline" disabled={!adding[workspace.id]} onClick={() => void add(workspace.id)}>{t('ws.add')}</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      {data.canManage && repo.createWorkspace && (
        <form className="flex flex-col gap-2 border-t border-rail pt-3" onSubmit={(event) => void create(event)}>
          <label className="text-[13px] font-medium" htmlFor="ws-new-name">{t('ws.create.label')}</label>
          <Input id="ws-new-name" value={name} placeholder={t('ws.create.placeholder')} required maxLength={80}
            onChange={(event) => setName(event.target.value)} className="max-w-[20rem]" />
          <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
            <legend className="mb-1 text-[13px] font-medium">{t('ws.create.who')}</legend>
            {members.filter((m) => !m.you).map((member) => (
              <label key={member.userId} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={picked.includes(member.userId)}
                  onChange={(event) => setPicked((prev) => event.target.checked
                    ? [...prev, member.userId] : prev.filter((id) => id !== member.userId))}
                />
                {member.email}
              </label>
            ))}
          </fieldset>
          <div><Button type="submit" disabled={busy}>{t('ws.create.button')}</Button></div>
        </form>
      )}
    </Card>
  );
}
