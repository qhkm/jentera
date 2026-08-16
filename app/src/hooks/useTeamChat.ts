/* ============================================================
   Team Chat — one shared space for you plus every agent, split
   into channels. Tag @agent and that agent answers.

   #escalations is not hand-written: it mirrors the Work view.
   Every unresolved "needs you" item is logged, and approving one
   appends a closure message. Dedupe is by source index, so the
   sync is idempotent across re-renders.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TEAM_CHANNELS, TEAM_GENERAL, TEAM_REPLIES } from '@/lib/data/conversations';
import type { Business, TeamMember } from '@/lib/types';

export type ChannelId = keyof typeof TEAM_CHANNELS;

export interface TeamMessage {
  from: 'agent' | 'you';
  name: string;
  text: string;
  time: string;
  /** index into business.work, for escalation dedupe */
  srcIdx?: number;
  done?: boolean;
}

export const CHANNEL_IDS = Object.keys(TEAM_CHANNELS) as ChannelId[];

function seedChannels(team: TeamMember[]): Record<string, TeamMessage[]> {
  const first = team[0]?.n ?? 'Customer Assistant';
  const last = team.length > 1 ? team[team.length - 1].n : first;

  return {
    '#pasukan': [
      { from: 'agent', name: first, text: 'Morning! Semua channel aktif. 2 escalation menunggu approval kau kat Work.', time: '8:02 AM' },
      { from: 'you', name: 'Kau', text: `Ok nanti aku semak. @${last}, boleh siapkan laporan sebelum Jumaat?`, time: '8:15 AM' },
      { from: 'agent', name: last, text: 'Boleh. Laporan siap esok 9 pagi — aku tag kau bila dah sedia. ✅', time: '8:16 AM' },
    ],
    '#escalations': [],
    '#random': [
      { from: 'agent', name: first, text: 'Channel ni untuk benda santai — share apa-apa je! 🎉', time: '11:00 AM' },
      { from: 'you', name: 'Kau', text: 'Nice. Sesiapa boleh cadangkan promo hujung minggu? 💡', time: '11:02 AM' },
      { from: 'agent', name: last, text: 'Aku cadang bundle untuk pelanggan regular. 😋', time: '11:05 AM' },
    ],
  };
}

/** Find the first @mentioned agent in a message. */
export function findMention(text: string, team: TeamMember[]): TeamMember | null {
  const lower = (text || '').toLowerCase();
  return team.find((m) => lower.includes(`@${m.n.toLowerCase()}`)) ?? null;
}

export function useTeamChat(
  business: Business,
  workDone: (i: number) => boolean,
) {
  const [selected, setSelected] = useState<ChannelId>('#pasukan');
  const [channels, setChannels] = useState<Record<string, TeamMessage[]>>(() =>
    seedChannels(business.team),
  );
  const [typing, setTyping] = useState(false);
  const timer = useRef<number | null>(null);
  /** Deterministic reply rotation — Math.random would break re-render stability. */
  const turn = useRef(0);

  // Re-seed when the business changes; conversations are per-playbook.
  useEffect(() => {
    setChannels(seedChannels(business.team));
  }, [business.team]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // Mirror Work escalations into #escalations, deduped by source index.
  useEffect(() => {
    setChannels((prev) => {
      const existing = prev['#escalations'] ?? [];
      const open = new Set(existing.filter((m) => m.srcIdx !== undefined && !m.done).map((m) => m.srcIdx));
      const closed = new Set(existing.filter((m) => m.done).map((m) => m.srcIdx));
      const additions: TeamMessage[] = [];

      business.work.forEach((w, i) => {
        if (workDone(i)) {
          if (!closed.has(i)) {
            additions.push({
              from: 'agent',
              name: w.n || 'AISAR',
              srcIdx: i,
              done: true,
              time: 'now',
              text: `✅ Escalation closed — approved and sent. (from ${w.n || 'AISAR'})`,
            });
          }
        } else if (w.tag === 'needs you' && !open.has(i)) {
          additions.push({
            from: 'agent',
            name: w.n || 'AISAR',
            srcIdx: i,
            time: 'now',
            text: `⚠️ Escalation: ${w.d} — approve it in Work.`,
          });
        }
      });

      if (!additions.length) return prev;
      return { ...prev, '#escalations': [...existing, ...additions] };
    });
  }, [business.work, workDone]);

  const unreadFor = useCallback(
    (id: ChannelId): number => {
      if (id !== '#escalations') return 0;
      return business.work.filter((w, i) => !workDone(i) && w.tag === 'needs you').length;
    },
    [business.work, workDone],
  );

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      const channel = selected;

      setChannels((prev) => ({
        ...prev,
        [channel]: [...(prev[channel] ?? []), { from: 'you', name: 'Kau', text: body, time: 'now' }],
      }));

      const target = findMention(body, business.team);
      const pool = target ? (TEAM_REPLIES[target.n] ?? TEAM_GENERAL) : TEAM_GENERAL;
      const reply = pool[turn.current % pool.length];
      turn.current += 1;
      const author = target?.n ?? business.team[0]?.n ?? 'AISAR';

      setTyping(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setTyping(false);
        setChannels((prev) => ({
          ...prev,
          [channel]: [...(prev[channel] ?? []), { from: 'agent', name: author, text: reply, time: 'now' }],
        }));
      }, 1100);
    },
    [selected, business.team],
  );

  const messages = useMemo(() => channels[selected] ?? [], [channels, selected]);

  return {
    selected,
    select: setSelected,
    messages,
    send,
    typing,
    unreadFor,
    channels: CHANNEL_IDS,
    meta: TEAM_CHANNELS,
  };
}
