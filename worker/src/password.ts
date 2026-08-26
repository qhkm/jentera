/* ============================================================
   Password hashing.

   PBKDF2-HMAC-SHA256, because it is what the Workers runtime actually
   has. bcrypt, scrypt and Argon2 are the better choices on a normal
   server, and none of them exist in WebCrypto — reaching for them here
   means shipping a pure-JS or WASM implementation and paying for it out
   of a request CPU budget measured in milliseconds.

   PBKDF2 is weaker per unit of work against GPU attack. The mitigation
   is iteration count, and the constraint is that hashing happens inline
   in a request. ITERATIONS is therefore tuned against the deployed
   Worker rather than copied from a recommendation written for hardware
   that is not this.
   ============================================================ */

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/* Encoded as pbkdf2$sha256$<iterations>$<salt>$<hash>, base64 parts.
   The cost is stored per-hash so it can be raised later without
   invalidating everyone's password: an old hash still declares the
   iteration count it was made with, and verification honours it. */
const PREFIX = 'pbkdf2$sha256';

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${b64(salt.buffer)}$${b64(bits)}`;
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing for anything malformed: a corrupt
 * or unrecognised hash must fail closed, and must fail the same way a
 * wrong password does.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;

  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5_000_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = unb64(parts[3]);
    expected = unb64(parts[4]);
  } catch {
    return false;
  }

  const actual = new Uint8Array(await derive(password, salt, iterations));
  if (actual.length !== expected.length) return false;

  /* Constant time. A byte-by-byte early return would leak how much of
     the hash matched, which over enough attempts recovers it. */
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/**
 * The minimum that is worth enforcing.
 *
 * Length only. Composition rules ("one uppercase, one symbol") push
 * people towards Passw0rd! and are explicitly discouraged by NIST
 * 800-63B, which asks for length and a blocklist instead. The blocklist
 * is the part worth adding later; arbitrary character classes are not.
 */
export const MIN_PASSWORD = 10;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'password is required';
  if (password.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  // Cap it: PBKDF2 cost is independent of input length, but an
  // unbounded body is still an unbounded body.
  if (password.length > 512) return 'password is too long';
  return null;
}

/**
 * A real hash of a password nobody knows.
 *
 * Login verifies against this when the address has no account, so a
 * miss costs the same PBKDF2 work as a hit. Without it, "no such user"
 * returns in microseconds while "wrong password" takes ~100ms, and
 * that gap enumerates the user table regardless of what the status
 * codes say. Constant because deriving one per cold start would spend
 * the same CPU it exists to spend evenly.
 */
export const DUMMY_HASH =
  'pbkdf2$sha256$100000$Hw18UYpY+gANzcVSyMfPmg==$G+ayo52mtxutCEn5/EWPBUfQ2QtgsYK3YGtuDFKuELA=';
