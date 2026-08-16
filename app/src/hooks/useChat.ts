/* ============================================================
   Per-agent conversations. Each agent has a thread; you can take
   over from the AI and reply as the business, then hand back.

   Conversation content comes from two places:
     · hand-written seeds, keyed on agent name (rich, but they only
       exist for the restaurant/retail agent names)
     · the playbook's own `work` items for that agent (industry-
       correct for all 20 playbooks)
   Both are combined, so every playbook has something to show.
   ============================================================ */

import { useCallback, useMemo, useRef, useState } from 'react';
import { CHAT_TEMPLATES } from '@/lib/data/conversations';
import type { Business, TeamMember } from '@/lib/types';

export type Speaker = 'agent' | 'cust' | 'you';

export interface ChatMessage {
  from: Speaker;
  /** customer name, on inbound messages */
  name?: string;
  text: string;
  time: string;
  tag?: string;
}

/** Hand-written demo threads, keyed by agent name. */
const SEEDS: Record<string, ChatMessage[]> = {
  'Customer Assistant': [
    { from: 'cust', name: 'Aisyah', text: 'Assalamualaikum, ada menu vegetarian tak? 😊', time: '9:02 AM' },
    { from: 'agent', text: 'Waalaikumsalam! Ada — Nasi Lemak Sayur, Pasta Aglio Olio, Salad Bowl. Nak saya hantar menu penuh?', time: '9:02 AM' },
    { from: 'cust', name: 'Aisyah', text: 'Ya tolong 🙏', time: '9:03 AM' },
    { from: 'agent', text: 'Dah hantar 📩 Ada apa-apa lagi, boleh tanya saya.', time: '9:04 AM' },
  ],
  'Booking Agent': [
    { from: 'cust', name: 'Farid', text: 'Nak booking Sabtu ni pukul 8 malam, 2 orang boleh?', time: '1:02 PM' },
    { from: 'agent', text: 'Boleh! Sabtu 8pm untuk 2 pax — saya check availability dulu ya.', time: '1:02 PM' },
    { from: 'cust', name: 'Farid', text: 'Ok 👍', time: '1:03 PM' },
    { from: 'agent', text: 'Confirmed ✅ Confirmation + reminder dah hantar ke WhatsApp.', time: '1:04 PM' },
  ],
  'Follow-up': [
    { from: 'agent', text: 'Hantar birthday promo ke 6 pelanggan lama (personalised, brand voice) 🎂', time: '11:00 AM' },
    { from: 'cust', name: 'Siti', text: 'Ohh ada promo birthday ke? Bagus!', time: '11:05 AM' },
    { from: 'agent', text: 'Alhamdulillah dapat sambutan — 2 dah reply nak redeem.', time: '11:20 AM' },
  ],
  'Ops Assistant': [
    { from: 'agent', text: 'Weekly report siap 📊 — sales minggu ni naik 12% vs minggu lepas.', time: '8:00 AM' },
    { from: 'agent', text: 'Inventory alert: stok tinggal 3 hari. Nak aku auto-order dari supplier?', time: '8:15 AM' },
  ],
};

const REPLY = 'Siap ✓ dah hantar ke pelanggan. Ada apa-apa lagi?';
const TAKEOVER = 'Aku ambil alih dari sini.';
const HANDBACK = 'Ok, AI ambil alih balik ✓ — saya sambung urus pelanggan.';
const TYPING_MS = 1400;

/**
 * Business-neutral quick replies. The ported CHAT_TEMPLATES are keyed on
 * the restaurant/retail agent names, so 16 of the 20 playbooks had no
 * templates at all — a salon's "Reception Assistant" matched nothing.
 * These fill that gap without putting menu talk in a hair salon.
 */
const GENERIC_TEMPLATES = [
  'Apa status hari ni? 📊',
  'Hantar update ke pelanggan 💬',
  'Ringkaskan minggu ni 📈',
];

export function templatesFor(agent: string): string[] {
  return CHAT_TEMPLATES[agent] ?? GENERIC_TEMPLATES;
}

export function useChat(business: Business) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [controller, setController] = useState<Record<string, 'ai' | 'you'>>({});
  const [custom, setCustom] = useState<Record<string, ChatMessage[]>>({});
  const [typing, setTyping] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  /** Seed messages for an agent: hand-written thread + its work items. */
  const baseFor = useCallback(
    (agent: TeamMember): ChatMessage[] => {
      const seed = SEEDS[agent.n] ?? [];
      const fromWork = business.work
        .filter((w) => w.n === agent.n)
        .map<ChatMessage>((w) => ({ from: 'agent', text: w.d, time: 'now', tag: w.tag }));
      return [...seed, ...fromWork];
    },
    [business.work],
  );

  const conversation = useCallback(
    (agentName: string): ChatMessage[] => {
      const agent = business.team.find((m) => m.n === agentName);
      if (!agent) return [];
      return [...baseFor(agent), ...(custom[agentName] ?? [])];
    },
    [business.team, baseFor, custom],
  );

  const preview = useCallback(
    (agentName: string): string => {
      const msgs = conversation(agentName);
      return msgs.length ? msgs[msgs.length - 1].text : '';
    },
    [conversation],
  );

  const visibleAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return business.team;
    return business.team.filter(
      (m) =>
        m.n.toLowerCase().includes(q) ||
        (m.ch ?? '').toLowerCase().includes(q) ||
        preview(m.n).toLowerCase().includes(q),
    );
  }, [business.team, query, preview]);

  const push = useCallback((agent: string, msg: ChatMessage) => {
    setCustom((prev) => ({ ...prev, [agent]: [...(prev[agent] ?? []), msg] }));
  }, []);

  const takeOver = useCallback(
    (agent: string) => {
      setController((prev) => ({ ...prev, [agent]: 'you' }));
      push(agent, { from: 'you', text: TAKEOVER, time: 'now' });
    },
    [push],
  );

  const handBack = useCallback(
    (agent: string) => {
      setController((prev) => ({ ...prev, [agent]: 'ai' }));
      push(agent, { from: 'agent', text: HANDBACK, time: 'now' });
    },
    [push],
  );

  const send = useCallback(
    (agent: string, text: string) => {
      const body = text.trim();
      if (!body) return;
      push(agent, { from: 'you', text: body, time: 'now' });
      setTyping(agent);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setTyping(null);
        push(agent, { from: 'agent', text: REPLY, time: 'now' });
      }, TYPING_MS);
    },
    [push],
  );

  const controllerOf = useCallback(
    (agent: string): 'ai' | 'you' => controller[agent] ?? 'ai',
    [controller],
  );

  return {
    selected,
    open: setSelected,
    close: () => setSelected(null),
    query,
    setQuery,
    visibleAgents,
    conversation,
    preview,
    controllerOf,
    takeOver,
    handBack,
    send,
    typing,
  };
}
