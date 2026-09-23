/* Malaysian phone numbers only (spec D8). Stored as digits with the country
   code, 60…, which is also the form wa.me expects. Anything that is not a
   Malaysian number is refused rather than guessed at. */

const ALLOWED = /^\+?[0-9\s().-]+$/;
const STORED = /^60[0-9]{8,11}$/;

export function normalizeMyPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || !ALLOWED.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  const normalized = trimmed.startsWith('+') || digits.startsWith('60')
    ? digits
    : digits.startsWith('0') ? `6${digits}` : '';
  return STORED.test(normalized) ? normalized : null;
}
