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
 * Links are the deliberate omission. `[text](url)` renders as its text with
 * the address beside it, visible and inert. A crafted page that talks the
 * model into emitting "[Verify your account](https://evil.example)" gets
 * words in a chat window, not a button for the owner to click.
 */

const FENCE = /^```[^\n]*\n([\s\S]*?)```$/;

/** Inline marks, applied left to right: `code`, **bold**, [text](url). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] !== undefined) {
      nodes.push(<code key={key} className="reply-code">{match[1]}</code>);
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={key}>{match[2]}</strong>);
    } else {
      /* Text first, address second and plain: the owner can read where it
         points and copy it on purpose, but nothing here is clickable. */
      nodes.push(
        <span key={key}>
          {match[3]} <span className="reply-link-url">{match[4]}</span>
        </span>,
      );
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
        out.push(<span key={key}>{renderInline(body, key)}</span>);
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
            <li key={`${key}-${i}`}>{renderInline(listLabel(item), `${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      listBuffer = [];
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const key = `p-${partIndex}-${lineIndex}`;
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
              {renderInline(cell, `${key}-head-${c}`)}
            </th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) =>
              <td key={c} style={{ textAlign: alignments[c] }}>{renderInline(row[c] ?? '', `${key}-${r}-${c}`)}</td>,
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
