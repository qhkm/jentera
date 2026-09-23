/* ============================================================
   What Jentera knows about this business, and how it came to know it.

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
import { CaretDown, ClockCounterClockwise, PencilSimple, Plus, UploadSimple } from '@phosphor-icons/react';
import { renderSourceLink } from '@/lib/reply-markdown';
import { Button, Card, Eyebrow, Input, LoadingState, Tag } from '@/components/ui';
import { useMutate, useRefresh, useRepository, useSnapshot } from '@/lib/repo';
import type { Fact } from '@/lib/repo/types';
import type { Tone } from '@/lib/types';
import AgentMemoryPanel from './AgentMemoryPanel';
import { useSignedIn } from '@/lib/repo/gate';
import { useT } from '@/i18n/I18nProvider';

/* Below this, a page gave up little more than its <title>: almost
   certainly a JavaScript-rendered shell rather than a thin site. 400
   characters is roughly a short paragraph — under it there is nothing
   an owner would recognise as their page. */
const SHELL_CHARS = 400;

/**
 * What to tell the owner about a read.
 *
 * Reporting "found 1 thing" for a page Jentera could not actually see
 * reads as "I read your site". jentera.ai returns a 727-byte shell
 * that strips to 43 characters of title, and Jentera duly reported a
 * successful read of a site whose text it never received. Saying which
 * happened costs one sentence and saves the owner trusting a fact base
 * built from a page title.
 */
export function describeRead(r: { facts: number; chars: number }, file?: string): string {
  if (file) {
    /* A document has no JavaScript shell to warn about; short is just short. */
    return r.facts === 0
      ? `Jentera read ${file} but found nothing clear enough to suggest. Documents with your hours, prices, services or policies work best.`
      : `Jentera found ${r.facts} thing${r.facts === 1 ? '' : 's'} in ${file}. They are listed above, waiting for you to confirm.`;
  }
  if (r.chars < SHELL_CHARS) {
    const found =
      r.facts === 0
        ? 'nothing to suggest'
        : `${r.facts} thing${r.facts === 1 ? '' : 's'} from the title alone`;
    return `That page needs JavaScript to show its content, so Jentera only saw ${r.chars} characters of it — ${found}. Point it at a page that works with JavaScript off, or add what matters below.`;
  }
  return r.facts === 0
    ? 'Jentera read the page but found nothing clear enough to suggest. A page with your hours, prices or services works best.'
    : `Jentera found ${r.facts} thing${r.facts === 1 ? '' : 's'}. They are listed above, waiting for you to confirm.`;
}

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
  if (f.source === 'agent') return `Jentera found this · ${pct}% sure`;
  if (f.source === 'import') return `Imported · ${pct}% sure`;
  return `From a connection · ${pct}% sure`;
}

function FactRow({ fact, canManage }: { fact: Fact; canManage: boolean }) {
  const t = useT();
  const mutate = useMutate();
  const repo = useRepository();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(show(fact.value));
  const [history, setHistory] = useState<Fact[] | null>(null);
  const [details, setDetails] = useState(false);

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
    <div className={`knowledge-fact ${fact.confirmed ? '' : 'knowledge-fact-review'} border-b border-rail py-3 last:border-b-0`}>
      <div className="knowledge-fact-layout">
        <div className="knowledge-fact-main">
          <div className="knowledge-fact-heading">
            <span className="text-sm font-medium text-text">{label(fact.key)}</span>
            {!fact.confirmed && <Tag tone={sourceTone(fact)}>Needs review</Tag>}
          </div>
          {fact.pending && <p className="text-sm text-text-secondary">{t('knowledge.currentValue', { value: show(fact.currentValue) })}</p>}
          {editing && canManage ? (
            <Input
              className="min-w-[12rem]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`Value for ${label(fact.key)}`}
            />
          ) : <span className="text-sm text-text-secondary">{show(fact.value)}</span>}
          {!fact.confirmed && !editing && <span className="knowledge-fact-source">{sourceLabel(fact)}</span>}
        </div>
        <div className="knowledge-fact-actions">
          {editing && canManage ? <>
            <Button onClick={save}>Save</Button>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </> : <>
            {!fact.confirmed && canManage && (
              <Button onClick={() => void mutate((r) => r.confirmFact(fact.key, fact.version)).catch(noop)}>
                That&rsquo;s right
              </Button>
            )}
            {canManage && <Button variant="outline" onClick={() => { setDraft(show(fact.value)); setEditing(true); }}>
              <PencilSimple size={16} aria-hidden="true" />
              {fact.confirmed ? 'Change' : 'Fix it'}
            </Button>}
          </>}
        </div>
      </div>

      {(fact.sourceRef || fact.confirmed || fact.version > 1 || (!fact.confirmed && canManage)) && <div className="knowledge-fact-details">
        <button type="button" className="knowledge-details-toggle" aria-expanded={details} onClick={() => setDetails(value => !value)}>
          {details ? 'Hide details' : 'Details'}<CaretDown size={14} aria-hidden="true" />
        </button>
        {details && <div className="knowledge-fact-details-body">
          <p>{sourceLabel(fact)}</p>
          {fact.sourceRef && <p>{t('knowledge.source', { source: '' })}{renderSourceLink(fact.sourceRef)}</p>}
          <div className="knowledge-detail-actions">
            {fact.version > 1 && <Button variant="ghost" onClick={() => void toggleHistory()}>
              <ClockCounterClockwise size={16} aria-hidden="true" />
              {history ? 'Hide history' : `${fact.version} versions`}
            </Button>}
            {canManage && !fact.confirmed && <Button variant="ghost"
              onClick={() => void mutate((r) => r.forgetFact(fact.key, fact.version)).catch(noop)}>{t('knowledge.discard')}</Button>}
          </div>
          {history && <ol className="knowledge-history">
            {history.map((h) => <li key={h.version}>
              <span>v{h.version}</span> {show(h.value)} <span>— {sourceLabel(h)}</span>
            </li>)}
          </ol>}
        </div>}
      </div>}
    </div>
  );
}

export default function KnowledgePanel() {
  const snap = useSnapshot();
  const signedIn = useSignedIn();
  const canManage = snap.canManageKnowledge ?? !signedIn;
  const mutate = useMutate();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [site, setSite] = useState('');
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const repo = useRepository();
  const refresh = useRefresh();

  async function read() {
    setReading(true);
    setNote(null);
    try {
      const r = await repo.ingest(site.trim());
      setNote(describeRead(r));
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

  /* A document instead of an address: the same reading, from bytes the
     owner hands over. The file is not kept, only what was learned. */
  async function readFile(file: File | undefined) {
    if (!file || !repo.ingestFile) return;
    setReading(true);
    setNote(null);
    try {
      const r = await repo.ingestFile(file);
      setNote(describeRead(r, file.name));
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read that file.');
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
    <div className="knowledge-view">
      <Card className="knowledge-overview">
        <div className="knowledge-overview-heading">
          <div><Eyebrow>Knowledge</Eyebrow><h2>Business brief</h2><p>One place for the details Jentera uses when working for you.</p></div>
          <Tag tone={unconfirmed > 0 ? 'amber' : 'neutral'}>{facts.length} {facts.length === 1 ? 'item' : 'items'}</Tag>
        </div>
        {unconfirmed > 0 && <p className="knowledge-review-note">
          {unconfirmed === 1 ? 'One item needs your review.' : `${unconfirmed} items need your review.`}
          {' '}Jentera will not use them with customers until you confirm them.
        </p>}
        {facts.length === 0 ? (
          <p className="knowledge-empty">
            Nothing here yet. Add a useful detail, or let Jentera read your website or a document.
          </p>
        ) : (
          <div className="knowledge-facts">
            {facts.map((f) => (
              <FactRow key={`${f.key}:${f.version}`} fact={f} canManage={canManage} />
            ))}
          </div>
        )}
      </Card>

      {canManage && <Card className="knowledge-tools">
        <Eyebrow>Add knowledge</Eyebrow>
        <div className="knowledge-tool-list">
          <details className="knowledge-tool">
            <summary><span><Plus size={19} aria-hidden="true" /><span><strong>Add something yourself</strong><small>Hours, prices, services, policies, or anything Jentera should know.</small></span></span><CaretDown size={16} aria-hidden="true" /></summary>
            <div className="knowledge-tool-body">
              <div className="knowledge-add-form">
                <Input placeholder="What is this about? e.g. Monday hours" value={key} onChange={(e) => setKey(e.target.value)} aria-label="What kind of fact" />
                <Input placeholder="What should Jentera know? e.g. 9am – 6pm" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" />
                <Button onClick={add} disabled={!key.trim() || !value.trim()}>Add</Button>
              </div>
            </div>
          </details>

          <details className="knowledge-tool">
            <summary><span><UploadSimple size={19} aria-hidden="true" /><span><strong>Import from a source</strong><small>Let Jentera suggest useful details from a website or document.</small></span></span><CaretDown size={16} aria-hidden="true" /></summary>
            <div className="knowledge-tool-body">
              <div className="knowledge-import-form">
                <Input placeholder="https://yourbusiness.com" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Your website address" disabled={reading} />
                <Button onClick={() => void read()} disabled={reading || !site.trim()}>{reading ? 'Reading…' : 'Read website'}</Button>
              </div>
              {repo.ingestFile && <label className="knowledge-file-input"><span>Or choose a document</span><input type="file" aria-label="Upload a document" accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.pptx,.html,.png,.jpg,.jpeg,.webp" disabled={reading} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /><small>Text, PDF, Word, Excel, PowerPoint, or an image. The file is not kept.</small></label>}
              {reading && <LoadingState compact title="Reading your source…" detail="Preparing suggestions for you to review." />}
              {note && <p role="status" className="knowledge-import-note">{note}</p>}
            </div>
          </details>

          {repo.agentMemory && <details className="knowledge-tool" onToggle={(event) => setMemoryOpen(event.currentTarget.open)}>
            <summary><span><ClockCounterClockwise size={19} aria-hidden="true" /><span><strong>Things Jentera picked up while working</strong><small>Review or remove informal notes from your bots.</small></span></span><CaretDown size={16} aria-hidden="true" /></summary>
            <div className="knowledge-tool-body">{memoryOpen && <AgentMemoryPanel embedded />}</div>
          </details>}
        </div>
      </Card>}
    </div>
  );
}
