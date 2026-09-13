/** Keep the full prompt for execution, but give continuation tasks a short title. */
export function taskTitle(value: string): string {
  const cleaned = value.replace(/^(?:Continue this task:|Teruskan tugasan ini:)\s*/i, '')
    .split(/\s*(?:Previous result:|Hasil terdahulu:)/i)[0].replace(/\s+/g, ' ').trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}
