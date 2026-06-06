/** Password hashing for Content OS login.
 *
 *  PBKDF2-SHA256 via Workers-native `crypto.subtle.deriveBits`. ~10ms per
 *  hash at 600k iterations. No WASM bcrypt needed.
 *
 *  Hash + salt are stored as hex strings in the D1 `users` table; the
 *  iteration count is stored alongside so we can upgrade the cost factor
 *  later without invalidating existing passwords.
 *
 *  We also expose the SAME hash algorithm so install.sh can mint the
 *  initial password hash from a tiny Node helper (Node's built-in
 *  crypto.pbkdf2Sync uses the same primitive). Cross-runtime hashes must
 *  byte-equal for the verify check to pass. */

// Cloudflare Workers caps PBKDF2 iterations at 100,000. Anything higher
// throws "Pbkdf2 failed: iteration counts above 100000 are not supported".
// 100k SHA-256 + 16-byte random salt is still well above OWASP's older
// 10k recommendation; the cap is the active constraint, not security.
const DEFAULT_ITERS = 100_000;
const KEY_LEN_BYTES = 32;
const SALT_LEN_BYTES = 16;

export interface HashRecord {
  hash: string; // hex(KEY_LEN_BYTES)
  salt: string; // hex(SALT_LEN_BYTES)
  iters: number;
}

/** Mint a fresh hash for a plaintext password. */
export async function hashPassword(plaintext: string, iters = DEFAULT_ITERS): Promise<HashRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN_BYTES));
  const hash = await derive(plaintext, salt, iters);
  return {
    hash: toHex(hash),
    salt: toHex(salt),
    iters,
  };
}

/** Constant-time verify. Returns true iff the plaintext matches. */
export async function verifyPassword(
  plaintext: string,
  record: { hash: string; salt: string; iters: number },
): Promise<boolean> {
  const expected = fromHex(record.hash);
  const salt = fromHex(record.salt);
  const actual = await derive(plaintext, salt, record.iters);
  return timingSafeEqual(expected, actual);
}

async function derive(plaintext: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(plaintext),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" },
    key,
    KEY_LEN_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
