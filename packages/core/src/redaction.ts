// Redaction of secrets before anything is logged, displayed as a diagnostic or
// exported (specification sections 20 and 21). Redaction is deliberately
// over-inclusive: a redacted harmless value costs little, a leaked RPC
// password or extended private key costs a great deal.

export const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word|phrase)?$/i,
  /^rpcauth$/i,
  /secret/i,
  /token/i,
  /cookie/i,
  /macaroon/i,
  /^runes?$/i,
  /mnemonic/i,
  /^seed/i,
  /private.?key/i,
  /^x?prv$/i,
  /authori[sz]ation/i,
  /api.?key/i,
  /credential/i,
  /^plaintext$/i,
  /^protected$/i,
];

const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  // Extended private keys (BIP32 and SLIP-0132 variants, mainnet and test networks).
  /\b[xyztuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{100,112}\b/g,
  // HTTP authorisation headers.
  /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{8,}/g,
  // Bitcoin Core RPC cookie contents.
  /__cookie__:[0-9a-fA-F]{16,}/g,
  // Credentials embedded in URLs: scheme://user:password@host
  /(?<=:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/g,
  // Hex blobs of macaroon length.
  /\b0201[0-9a-fA-F]{100,}\b/g,
  // Bitcoin Core quotes the offending bitcoin.conf line in parse errors, which may hold a password.
  /(?<=parse error on line \d+: )[^\r\n]+/gi,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactString(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, REDACTED), value);
}

/**
 * Returns a deep copy of `value` with sensitive fields and sensitive-looking
 * strings replaced. Cycles are broken rather than followed.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      isSensitiveKey(key) && item !== null && item !== undefined && item !== '' ? REDACTED : redactValue(item, seen);
  }
  return result;
}
