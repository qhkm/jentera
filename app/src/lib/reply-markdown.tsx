import type { ReactNode } from 'react';

/**
 * The small part of Markdown the agent actually writes, rendered as elements.
 *
 * Answers arrive as plain strings and were shown as plain strings, so a reply
 * containing `**Two ways to use it:**` and a fenced code block displayed its
 * asterisks and backticks. This renders the handful of marks that carry
 * meaning — bold, inline code, fenced code, lists, and pipe tables.
 *
 * It builds React nodes and never HTML. There is no `dangerouslySetInnerHTML`
 * here and there must not be one: an answer is model output, and since
 * `web_extract` began pulling arbitrary pages into the model's context, that
 * output can carry text a stranger's web page chose. React escapes every
 * string it renders, so injection is impossible by construction rather than
 * sanitised afterwards.
 *
 * Links allow absolute HTTP(S) only, without embedded credentials. Named
 * links show their actual destination too. They never fetch previews, execute
 * HTML, or imply the destination is trusted merely because the model wrote it.
 */

const FENCE = /^```[^\n]*\n([\s\S]*?)```$/;

/** Source metadata is a literal URL or filename, not model-authored Markdown. */
export function renderSourceLink(source: string): ReactNode {
  return /^https?:\/\//i.test(source) ? renderLink(null, source, 'source') : source;
}

function renderLink(label: string | null, raw: string, key: string): ReactNode {
  let url: URL;
  try {
    if (!/^https?:\/\//i.test(raw) || /[\s\u0000-\u001f\u007f\\]/.test(raw)) throw new Error();
    url = new URL(raw);
    if (url.username || url.password) throw new Error();
  } catch { return <span key={key}>{label ? `${label} (${raw})` : raw}</span>; }
  return <a key={key} className="reply-link" href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
    {label || url.href}{label && <span className="reply-link-url"> ({url.href})</span>}
  </a>;
}

/** Inline marks, applied left to right: `code`, **bold**, [text](url). */
function renderInline(text: string, keyPrefix: string, references: Map<string, string> = new Map()): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)|\[([^\]]+)\](?:\[([^\]]*)\])?|https?:\/\/[^\s<>"`]+/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] !== undefined) {
      nodes.push(<code key={key} className="reply-code">{match[1]}</code>);
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(match[2], key, references)}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(renderLink(match[3], match[4], key));
    } else if (match[5] !== undefined) {
      const target = references.get((match[6] || match[5]).trim().replace(/\s+/g, ' ').toLowerCase());
      nodes.push(target ? renderLink(match[5], target, key) : match[0]);
    } else {
      let raw = match[0].replace(/[.,;:!?]+$/, '');
      while (raw.endsWith(')') && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1);
      raw = raw.replace(/[\]}]+$/, '');
      nodes.push(renderLink(null, raw, key), match[0].slice(raw.length));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isListLine(line: string): boolean {
  return /^\s*([-*]|\d+\.)\s+/.test(line);
}

function listLabel(line: string): string {
  return line.replace(/^\s*([-*]|\d+\.)\s+/, '');
}

/** Split unescaped pipes, allowing optional outer pipes and literal \| in cells. */
function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && ['|', '\\'].includes(line[i + 1])) cell += line[++i];
    else if (line[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += line[i];
  }
  cells.push(cell.trim());
  if (cells.length > 1 && cells[0] === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** Split on fenced blocks first: nothing inside a fence is interpreted. */
export function renderReplyMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(```[^\n]*\n[\s\S]*?```)/g);
  const references = new Map<string, string>();
  // Only explicit definitions supply destinations; never invent URLs for citations.
  const definition = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^<>\s]+)>|(\S+))(?:\s+"[^"]*")?\s*$/;
  for (const part of parts) {
    if (FENCE.test(part)) continue;
    for (const line of part.split('\n')) {
      const match = definition.exec(line);
      if (match) {
        const id = match[1].trim().replace(/\s+/g, ' ').toLowerCase();
        if (!references.has(id)) references.set(id, match[2] || match[3]);
      }
    }
  }

  parts.forEach((part, partIndex) => {
    if (!part) return;
    const fenced = FENCE.exec(part);
    if (fenced) {
      out.push(
        <pre key={`fence-${partIndex}`} className="reply-pre">
          <code>{fenced[1].replace(/\n$/, '')}</code>
        </pre>,
      );
      return;
    }

    /* Outside fences, group consecutive list lines so they become one list
       rather than a run of stray bullets. */
    const lines = part.split('\n');
    let buffer: string[] = [];
    let listBuffer: string[] = [];

    const flushText = (key: string) => {
      if (!buffer.length) return;
      const body = buffer.join('\n');
      if (body.trim()) {
        out.push(<span key={key}>{renderInline(body, key, references)}</span>);
      } else {
        out.push(body);
      }
      buffer = [];
    };
    const flushList = (key: string) => {
      if (!listBuffer.length) return;
      out.push(
        <ul key={key} className="reply-list">
          {listBuffer.map((item, i) => (
            <li key={`${key}-${i}`}>{renderInline(listLabel(item), `${key}-${i}`, references)}</li>
          ))}
        </ul>,
      );
      listBuffer = [];
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const key = `p-${partIndex}-${lineIndex}`;
      const source = definition.exec(line);
      if (source) {
        flushText(`t-${key}`);
        flushList(`l-${key}`);
        out.push(<span key={`source-${key}`}>{renderLink(source[1], source[2] || source[3], key)}{'\n'}</span>);
        continue;
      }
      const headers = tableCells(line);
      const separators = tableCells(lines[lineIndex + 1] ?? '');
      if (line.includes('|') && headers.length === separators.length &&
          separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
        flushText(`t-${key}`);
        flushList(`l-${key}`);
        const rows: string[][] = [];
        lineIndex += 2;
        while (lineIndex < lines.length && lines[lineIndex].includes('|') && lines[lineIndex].trim()) {
          rows.push(tableCells(lines[lineIndex++]));
        }
        lineIndex--;
        const alignments = separators.map(cell => cell.endsWith(':')
          ? cell.startsWith(':') ? 'center' : 'right' : 'left');
        out.push(<div key={`table-${key}`} className="reply-table-scroll" tabIndex={0}>
          <table className="reply-table">
            <thead><tr>{headers.map((cell, c) => <th key={c} scope="col" style={{ textAlign: alignments[c] }}>
              {renderInline(cell, `${key}-head-${c}`, references)}
            </th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) =>
              <td key={c} style={{ textAlign: alignments[c] }}>{renderInline(row[c] ?? '', `${key}-${r}-${c}`, references)}</td>,
            )}</tr>)}</tbody>
          </table>
        </div>);
        continue;
      }
      if (isListLine(line)) {
        flushText(`t-${key}`);
        listBuffer.push(line);
        continue;
      }
      flushList(`l-${key}`);
      buffer.push(line);
    }
    flushText(`t-end-${partIndex}`);
    flushList(`l-end-${partIndex}`);
  });

  return out;
}
