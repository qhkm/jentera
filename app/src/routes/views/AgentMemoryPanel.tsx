/* ============================================================
   What Jentera has picked up on its own. Hermes keeps two small notes per
   specialist — its own observations and what it knows about the people it
   talks to — and this shows them as they are, with a "Forget" on each.
   Owner only; the panel mounts only where the repository can read it, and
   reads as "not available yet" on a runtime that cannot answer.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Eyebrow, LoadingState, Tag } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useRepository } from '@/lib/repo';
import type { AgentMemory, AgentMemoryFile } from '@/lib/repo';

const FILE_LABEL: Record<AgentMemoryFile['file'], string> = {
  'MEMORY.md': 'Its own notes',
  'USER.md': 'About the people it talks to',
};
const PROFILE_LABEL: Record<string, string> = {
  default: 'Chief of Staff', operations: 'Operations', customers: 'Customer communications', growth: 'Growth and marketing', records: 'Finance and records',
};

export default function AgentMemoryPanel() {
  const repo = useRepository();
  const toast = useToast();
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!repo.agentMemory) return;
    setError(null);
    try {
      setMemory(await repo.agentMemory());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read what Jentera remembers.');
    }
  }, [repo]);

  useEffect(() => { void load(); }, [load]);

  async function forget(profile: string, file: AgentMemoryFile['file'], text: string) {
    if (!repo.forgetAgentMemory) return;
    try {
      await repo.forgetAgentMemory({ profile, file, text });
      setConfirming(null);
      setMemory((prev) => prev ? {
        ...prev,
        profiles: prev.profiles.map((p) => p.profile !== profile ? p : {
          ...p, files: p.files.map((f) => f.file !== file ? f : { ...f, entries: f.entries.filter((e) => e.text !== text) }),
        }),
      } : prev);
      toast('Forgotten.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not forget that.', 'error');
    }
  }

  if (!repo.agentMemory) return null;
  const total = memory?.profiles.reduce((n, p) => n + p.files.reduce((m, f) => m + f.entries.length, 0), 0) ?? 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>What Jentera has picked up</Eyebrow>
        {memory?.available && <Tag>{total} {total === 1 ? 'note' : 'notes'}</Tag>}
      </div>
      <p className="mt-2 text-sm text-text-secondary">
        Things Jentera noted for itself while working: how this computer behaves, and what it has learned about
        the people it talks to. Confirmed business facts are handed to it separately, above. Forget anything
        that is wrong or should not be kept.
      </p>
      {error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span>{error}</span>
          <Button variant="outline" onClick={() => void load()}>Try again</Button>
        </div>
      ) : !memory ? (
        <LoadingState compact className="mt-3" title="Asking Jentera…" />
      ) : !memory.available ? (
        <p className="mt-3 text-sm text-text-secondary">Not available yet. Jentera’s computer is starting up or is on an older release.</p>
      ) : total === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">Nothing noted yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {memory.profiles.map((profile) => (
            <section key={profile.profile} aria-label={PROFILE_LABEL[profile.profile] ?? profile.profile}>
              <h4 className="m-0 text-[13px] font-medium">{PROFILE_LABEL[profile.profile] ?? profile.profile}</h4>
              {profile.files.filter((f) => f.entries.length).map((file) => (
                <div key={file.file} className="mt-2">
                  <p className="m-0 text-[11px] uppercase tracking-wide text-text-muted">{FILE_LABEL[file.file]}</p>
                  <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0" aria-label={`${PROFILE_LABEL[profile.profile] ?? profile.profile} · ${FILE_LABEL[file.file]}`}>
                    {file.entries.map((entry) => {
                      const key = `${profile.profile}:${file.file}:${entry.index}`;
                      return (
                        <li key={key} className="flex flex-wrap items-start justify-between gap-2 rounded-item border border-border px-3 py-2">
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px]">{entry.text}</span>
                          {repo.forgetAgentMemory && (confirming === key ? (
                            <span className="flex items-center gap-1">
                              <Button variant="outline" onClick={() => setConfirming(null)}>Keep</Button>
                              <Button onClick={() => void forget(profile.profile, file.file, entry.text)} aria-label={`Confirm forgetting: ${entry.text.slice(0, 40)}`}>Yes, forget</Button>
                            </span>
                          ) : (
                            <Button variant="outline" onClick={() => setConfirming(key)} aria-label={`Forget: ${entry.text.slice(0, 40)}`}>Forget</Button>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
