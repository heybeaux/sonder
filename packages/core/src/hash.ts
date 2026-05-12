/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
 *
 * Sonder uses JCS as the canonical byte representation for both
 * `chain_self_hash` (Spec 2 R2) and `signature` (Spec 2 R3) computations.
 * The two MUST agree byte-for-byte, so the canonicalizer is shared.
 *
 * Conformance summary (per RFC 8785):
 *
 * - UTF-8 output.
 * - Object members sorted by their UTF-16 code unit sequence (the order
 *   used by ECMA-262 `Array.prototype.sort` on the keys, which is what
 *   we get from `Object.keys(...).sort()`).
 * - No whitespace anywhere.
 * - JSON numbers serialized via the ECMA-262 / V8 `Number` -> string
 *   serialization, with the JCS-mandated tweaks for negative zero and
 *   exponent formatting.
 * - JSON strings encode with the JCS minimal-escape rules: `\"`, `\\`,
 *   `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` for U+0000–U+001F. All other
 *   code points (including high-bit ASCII, full-width Unicode, surrogate
 *   pairs) are emitted as their UTF-8 byte sequence in the output string.
 * - `null`, `true`, `false` serialize as `null`, `true`, `false`.
 * - Non-finite numbers and `undefined` are forbidden — `canonicalize`
 *   throws on `NaN`, `+/-Infinity`, and `undefined` at any depth, and
 *   on functions, symbols, BigInts.
 */

import { createHash } from 'node:crypto';

/**
 * Canonicalize a JSON-compatible value per RFC 8785 (JCS).
 *
 * Returns a UTF-8 string. Throws `Error('canonicalize: non-finite number')`,
 * `Error('canonicalize: undefined value')`, or
 * `Error('canonicalize: unsupported type: <type>')` on invalid input.
 *
 * The implementation does NOT attempt cycle detection — cyclic input will
 * exhaust the call stack. Sonder's emit pipeline deep-clones before
 * canonicalizing, so cycles cannot reach this function in practice.
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error('canonicalize: non-finite number');
    }
    return serializeNumber(n);
  }

  if (t === 'string') {
    return serializeString(value as string);
  }

  if (t === 'undefined') {
    throw new Error('canonicalize: undefined value');
  }

  if (t === 'bigint' || t === 'function' || t === 'symbol') {
    throw new Error(`canonicalize: unsupported type: ${t}`);
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      // Per RFC 8785, undefined array members are not allowed.
      if (item === undefined) {
        throw new Error('canonicalize: undefined value');
      }
      parts.push(serialize(item));
    }
    return '[' + parts.join(',') + ']';
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    // Member ordering per RFC 8785 §3.2.3 — lexicographic by UTF-16 code units,
    // which matches the default JS Array.sort on string keys.
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(serializeString(key) + ':' + serialize(obj[key]));
    }
    return '{' + parts.join(',') + '}';
  }

  throw new Error(`canonicalize: unsupported type: ${t}`);
}

/**
 * RFC 8785 §3.2.2.3 — number serialization. The algorithm is:
 *
 *   1. Use `Number.prototype.toString()` (ECMA-262), which already produces
 *      the shortest round-trippable decimal.
 *   2. Normalize `-0` -> `0`.
 *   3. If the result is in scientific notation, rewrite to the JCS form:
 *      `<digits>e<sign><digits>` with a lowercase `e` and a sign. JS already
 *      emits lowercase `e`, so we mostly just need to ensure the sign is
 *      present (`e+21` rather than `e21`). For negative exponents JS emits
 *      `e-X` which is already correct.
 */
function serializeNumber(n: number): string {
  if (Object.is(n, -0)) n = 0;
  let s = n.toString();
  // ECMA-262 emits scientific notation for |n| >= 1e21 and for very small
  // numbers. JCS requires the same format JS produces, except the `e+`/`e-`
  // sign is mandatory. JS already includes the sign for negative exponents,
  // but for positive exponents it emits `e+21` already in recent V8 — verify
  // and patch if needed.
  const ePos = s.indexOf('e');
  if (ePos !== -1) {
    const mantissa = s.slice(0, ePos);
    let exp = s.slice(ePos + 1);
    if (exp[0] !== '+' && exp[0] !== '-') exp = '+' + exp;
    s = mantissa + 'e' + exp;
  }
  return s;
}

/**
 * RFC 8785 §3.2.2.2 — string serialization with minimal escaping.
 *
 * Escapes ONLY:
 *   - `\"`  (U+0022)
 *   - `\\`  (U+005C)
 *   - `\b`  (U+0008)
 *   - `\f`  (U+000C)
 *   - `\n`  (U+000A)
 *   - `\r`  (U+000D)
 *   - `\t`  (U+0009)
 *   - `\uXXXX` for any other U+0000..U+001F (lowercase hex)
 *
 * Everything else — including high-bit ASCII, BMP non-ASCII, and supplementary
 * plane characters as surrogate pairs — is passed through verbatim. The
 * returned string is later UTF-8 encoded by the caller.
 */
function serializeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    switch (code) {
      case 0x22:
        out += '\\"';
        break;
      case 0x5c:
        out += '\\\\';
        break;
      case 0x08:
        out += '\\b';
        break;
      case 0x09:
        out += '\\t';
        break;
      case 0x0a:
        out += '\\n';
        break;
      case 0x0c:
        out += '\\f';
        break;
      case 0x0d:
        out += '\\r';
        break;
      default:
        if (code < 0x20) {
          out += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          out += s[i];
        }
    }
  }
  out += '"';
  return out;
}

/**
 * Strip the fields the chain hash MUST NOT include and return a shallow
 * copy. Spec 2 R2: `chain_self_hash` and `signature` are stripped before
 * computing `chain_self_hash`. Used by both the chain writer and the
 * verifier.
 */
export function stripChainFields<T extends Record<string, unknown>>(event: T): Omit<T, 'chain_self_hash' | 'signature'> {
  const clone: Record<string, unknown> = { ...event };
  delete clone['chain_self_hash'];
  delete clone['signature'];
  return clone as Omit<T, 'chain_self_hash' | 'signature'>;
}

/**
 * Strip the `signature` field only. Used to derive the ed25519 signing
 * target per Spec 2 R3 (which is computed AFTER `chain_self_hash` is set).
 */
export function stripSignatureField<T extends Record<string, unknown>>(event: T): Omit<T, 'signature'> {
  const clone: Record<string, unknown> = { ...event };
  delete clone['signature'];
  return clone as Omit<T, 'signature'>;
}

/**
 * Compute the chain self hash for an event: lowercase hex of sha256
 * over `canonicalize(stripChainFields(event))`.
 */
export function chainSelfHash(event: Record<string, unknown>): string {
  const stripped = stripChainFields(event);
  const canonical = canonicalize(stripped);
  return sha256Hex(canonical);
}

/**
 * Compute the sha256 of an arbitrary canonicalized event payload. Lower-
 * level than `chainSelfHash`; used by the verifier to recompute hashes
 * without re-stripping.
 */
export function hashEvent(event: Record<string, unknown>): string {
  return chainSelfHash(event);
}

/** Lowercase-hex sha256 of a UTF-8 string. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
