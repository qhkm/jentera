/* What a customer quotes back: six characters with no 0/O or 1/I, so it reads
   aloud and types cleanly. 32 symbols divide 256 exactly, so each byte maps
   to a symbol with no bias. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERENCE = /^[A-HJ-NP-Z2-9]{6}$/;

export function newReference(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(6)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}
