/* ============================================================
   What AISAR knows about this business, and how it came to know it.

   The provenance is the screen's reason for existing. A price the
   owner typed and a price a run extracted from their website are the
   same number and very different claims, and the owner is the only one
   who can settle the difference. Showing them identically would be a
   quieter, worse version of not asking at all.

   So unconfirmed facts sort to the top, carry their source and how
   sure it was, and offer one-tap confirmation. Everything else is
   secondary to that.
   ============================================================ */

import { useState } from 'react';
import { Button, Card, Eyebrow, Input, Tag } from '@/components/ui';
import { useMutate, useRefresh, useRepository, useSnapshot } from '@/lib/repo';
import type { Fact } from '@/lib/repo/types';
import type { Tone } from '@/lib/types';

const noop = () => {};

/** Human-readable rendering of a jsonb value. */
function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A dotted key as words: hours.monday → Hours · Monday */
function label(key: string): string {
  return key
    .split('.')
    .map((part) => part.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))
    .join(' · ');
}

function sourceTone(f: Fact): Tone {
  if (f.confirmed) return 'green';
  // An unconfirmed guess below two-thirds confidence is the case worth
  // interrupting someone for.
  return f.confidence < 0.67 ? 'amber' : 'neutral';
}

function sourceLabel(f: Fact): string {
  if (f.source === 'owner') return 'You said so';
  const pct = Math.round(f.confidence * 100);
  if (f.source === 'agent') return `AISAR found this · ${pct}% sure`;
  if (f.source === 'import') return `Imported · ${pct}% sure`;
  return `From a connection · ${pct}% sure`;
}

function FactRow({ fact }: { fact: Fact }) {
  const mutate = useMutate();
  const repo = useRepository();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(show(fact.value));
  const [history, setHistory] = useState<Fact[] | null>(null);

  function save() {
    // Typed by a person, so it is owner-sourced and self-confirming.
    void mutate((r) => r.setFact({ key: fact.key, value: draft, source: 'owner' })).then(
      () => setEditing(false),
      noop,
    );
  }

  async function toggleHistory() {
    if (history) return setHistory(null);
    setHistory(await repo.factHistory(fact.key));
  }

  return (
    <div className="flex flex-col gap-2 border-b border-rail py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">{label(fact.key)}</span>
        <Tag tone={sourceTone(fact)}>{sourceLabel(fact)}</Tag>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[12rem] flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Value for ${label(fact.key)}`}
          />
          <Button onClick={save}>Save</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-sm text-text-secondary">{show(fact.value)}</span>
          {!fact.confirmed && (
            <Button onClick={() => void mutate((r) => r.confirmFact(fact.key)).catch(noop)}>
              That&rsquo;s right
            </Button>
          )}
          <Button variant="ghost" onClick={() => setEditing(true)}>
            {fact.confirmed ? 'Change' : 'Fix it'}
          </Button>
          {fact.version > 1 && (
            <Button variant="ghost" onClick={() => void toggleHistory()}>
              {history ? 'Hide history' : `${fact.version} versions`}
            </Button>
          )}
        </div>
      )}

      {history && (
        <ol className="flex flex-col gap-1 pl-3 text-xs text-text-secondary">
          {history.map((h) => (
            <li key={h.version}>
              <span className="opacity-60">v{h.version}</span> {show(h.value)}{' '}
              <span className="opacity-60">— {sourceLabel(h)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function KnowledgePanel() {
  const snap = useSnapshot();
  const mutate = useMutate();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [site, setSite] = useState('');
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const repo = useRepository();
  const refresh = useRefresh();

  async function read() {
    setReading(true);
    setNote(null);
    try {
      const r = await repo.ingest(site.trim());
      setNote(
        r.facts === 0
          ? 'AISAR read the page but found nothing clear enough to suggest. A page with your hours, prices or services works best.'
          : `AISAR found ${r.facts} thing${r.facts === 1 ? '' : 's'}. They are listed above, waiting for you to confirm.`,
      );
      setSite('');
      // The facts live on the snapshot, so it has to be reloaded before
      // the list above reflects what was just written.
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read that page.');
    } finally {
      setReading(false);
    }
  }

  /* Unconfirmed first: those are the ones needing a decision. Within
     each group, least confident first. */
  const facts = [...snap.facts].sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
    if (a.confidence !== b.confidence) return a.confidence - b.confidence;
    return a.key.localeCompare(b.key);
  });

  const unconfirmed = facts.filter((f) => !f.confirmed).length;

  function add() {
    const k = key.trim().toLowerCase().replace(/\s+/g, '.');
    if (!k || !value.trim()) return;
    void mutate((r) => r.setFact({ key: k, value: value.trim(), source: 'owner' })).then(() => {
      setKey('');
      setValue('');
    }, noop);
  }

  return (
    <div className="flex flex-col gap-4">
      {unconfirmed > 0 && (
        <Card>
          <Eyebrow>Needs your eye</Eyebrow>
          <p className="mt-2 text-sm text-text-secondary">
            {unconfirmed === 1
              ? 'One thing AISAR worked out for itself and has not had confirmed.'
              : `${unconfirmed} things AISAR worked out for itself and has not had confirmed.`}{' '}
            It will not rely on them with customers until you say they are right.
          </p>
        </Card>
      )}

      <Card>
        <Eyebrow>What AISAR knows</Eyebrow>
        {facts.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            Nothing yet. Add something below, or point AISAR at your website and let it read.
          </p>
        ) : (
          <div className="mt-2 flex flex-col">
            {facts.map((f) => (
              <FactRow key={f.key} fact={f} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <Eyebrow>Let AISAR read your website</Eyebrow>
        <p className="mt-2 text-sm text-text-secondary">
          Paste the address and AISAR will read the page and suggest what it learned. Nothing is
          sent to anyone and nothing goes live — you confirm each item first.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[14rem] flex-1"
            placeholder="https://yourbusiness.com"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            aria-label="Your website address"
            disabled={reading}
          />
          <Button onClick={() => void read()} disabled={reading || !site.trim()}>
            {reading ? 'Reading…' : 'Read it'}
          </Button>
        </div>
        {note && (
          <p role="status" className="mt-3 text-sm text-text-secondary">
            {note}
          </p>
        )}
      </Card>

      <Card>
        <Eyebrow>Tell AISAR something</Eyebrow>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[10rem] flex-1"
            placeholder="hours.monday"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="What kind of fact"
          />
          <Input
            className="min-w-[10rem] flex-[2]"
            placeholder="9am – 6pm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Value"
          />
          <Button onClick={add} disabled={!key.trim() || !value.trim()}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
