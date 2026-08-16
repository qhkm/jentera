/* ============================================================
   @mention autocomplete.

   Agent names contain spaces ("Reception Assistant"), so the query
   cannot stop at a word boundary. Instead we take everything after
   the last '@' up to the caret and match it against the roster,
   closing the menu as soon as nothing matches — which is also what
   stops an ordinary email address from opening a picker.
   ============================================================ */

import { useCallback, useMemo, useState } from 'react';
import type { TeamMember } from '@/lib/types';

/** Longest partial we will treat as a mention query. */
const MAX_QUERY = 24;

export interface MentionState {
  /** Agents matching what has been typed after '@'. */
  matches: TeamMember[];
  /** Index into `matches`, for keyboard navigation. */
  active: number;
  open: boolean;
}

export function useMentions(team: TeamMember[]) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.trim().toLowerCase();
    return team.filter((m) => (q ? m.n.toLowerCase().includes(q) : true));
  }, [query, team]);

  const open = query !== null && matches.length > 0;

  /** Re-evaluate on every keystroke, from the text before the caret. */
  const sync = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');

    if (at < 0) {
      setQuery(null);
      return;
    }
    // Must start a token: beginning of input, or preceded by whitespace.
    const prev = at > 0 ? before[at - 1] : ' ';
    if (!/\s/.test(prev)) {
      setQuery(null);
      return;
    }
    const partial = before.slice(at + 1);
    if (partial.length > MAX_QUERY || partial.includes('\n')) {
      setQuery(null);
      return;
    }
    setQuery(partial);
    setActive(0);
  }, []);

  const close = useCallback(() => setQuery(null), []);

  const move = useCallback(
    (delta: number) => {
      setActive((i) => {
        const n = matches.length;
        if (!n) return 0;
        return (i + delta + n) % n;
      });
    },
    [matches.length],
  );

  /**
   * Replace the partial with the full name. Returns the new value and
   * where the caret should land, so the caller can restore it.
   */
  const complete = useCallback(
    (value: string, caret: number, member: TeamMember): { value: string; caret: number } => {
      const before = value.slice(0, caret);
      const at = before.lastIndexOf('@');
      if (at < 0) return { value, caret };
      const inserted = `@${member.n} `;
      const next = value.slice(0, at) + inserted + value.slice(caret);
      return { value: next, caret: at + inserted.length };
    },
    [],
  );

  return { matches, active, open, sync, close, move, complete, setActive };
}

/** The first agent tagged in a message, if any. */
export function taggedAgent(text: string, team: TeamMember[]): TeamMember | null {
  const lower = (text || '').toLowerCase();
  return team.find((m) => lower.includes(`@${m.n.toLowerCase()}`)) ?? null;
}
