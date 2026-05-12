import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  chainSelfHash,
  hashEvent,
  sha256Hex,
  stripChainFields,
  stripSignatureField,
} from '../hash.js';

/**
 * RFC 8785 JCS golden vectors + extensions.
 *
 * The vectors below come from three sources:
 *   1. RFC 8785 Appendix B (key ordering, number formatting, string escapes).
 *   2. The JCS test suite at https://github.com/cyberphone/json-canonicalization
 *      (Anders Rundgren's reference vectors).
 *   3. Sonder-specific shapes (SonderEvent envelope, governance evidence, etc.).
 *
 * Each `it` is one golden case. We also include a small property block to
 * cover deterministic ordering across object literal ordering.
 */

describe('canonicalize — RFC 8785 JCS', () => {
  // -----------------------------------------------------------------------
  // 1. Primitive values
  // -----------------------------------------------------------------------

  it('null primitive', () => {
    expect(canonicalize(null)).toBe('null');
  });

  it('true primitive', () => {
    expect(canonicalize(true)).toBe('true');
  });

  it('false primitive', () => {
    expect(canonicalize(false)).toBe('false');
  });

  it('integer zero', () => {
    expect(canonicalize(0)).toBe('0');
  });

  it('negative zero normalizes to 0', () => {
    expect(canonicalize(-0)).toBe('0');
  });

  it('integer one', () => {
    expect(canonicalize(1)).toBe('1');
  });

  it('negative integer', () => {
    expect(canonicalize(-42)).toBe('-42');
  });

  it('decimal one as JS Number serializes as `1` (no `.0`)', () => {
    expect(canonicalize(1.0)).toBe('1');
  });

  it('non-integer decimal', () => {
    expect(canonicalize(1.5)).toBe('1.5');
  });

  it('many decimals — shortest round-trip', () => {
    // 0.1 + 0.2 case: ensure we surface what Number.prototype.toString does.
    expect(canonicalize(0.1)).toBe('0.1');
  });

  it('large number requires scientific notation with explicit sign', () => {
    // 1e21 is the JS boundary where toString switches to exponential.
    expect(canonicalize(1e21)).toBe('1e+21');
  });

  it('negative scientific notation passes through with `-` sign', () => {
    expect(canonicalize(1e-7)).toBe('1e-7');
  });

  // -----------------------------------------------------------------------
  // 2. Strings — minimal escaping
  // -----------------------------------------------------------------------

  it('empty string', () => {
    expect(canonicalize('')).toBe('""');
  });

  it('plain ASCII string', () => {
    expect(canonicalize('hello')).toBe('"hello"');
  });

  it('quote escape', () => {
    expect(canonicalize('a"b')).toBe('"a\\"b"');
  });

  it('backslash escape', () => {
    expect(canonicalize('a\\b')).toBe('"a\\\\b"');
  });

  it('newline escape', () => {
    expect(canonicalize('a\nb')).toBe('"a\\nb"');
  });

  it('carriage return escape', () => {
    expect(canonicalize('a\rb')).toBe('"a\\rb"');
  });

  it('tab escape', () => {
    expect(canonicalize('a\tb')).toBe('"a\\tb"');
  });

  it('backspace escape', () => {
    expect(canonicalize('a\bb')).toBe('"a\\bb"');
  });

  it('form-feed escape', () => {
    expect(canonicalize('a\fb')).toBe('"a\\fb"');
  });

  it('low control char uses \\u escape (NUL)', () => {
    expect(canonicalize('\u0000')).toBe('"\\u0000"');
  });

  it('low control char uses \\u escape (0x1F)', () => {
    expect(canonicalize('\u001f')).toBe('"\\u001f"');
  });

  it('non-ASCII BMP code point passes through verbatim (no \\u escape)', () => {
    // RFC 8785 explicitly requires high-bit chars to pass through; the
    // serializer emits the JS string and the caller UTF-8 encodes.
    expect(canonicalize('café')).toBe('"café"');
  });

  it('supplementary plane / surrogate pair passes through', () => {
    // U+1F600 (grinning face) — encoded as 2-code-unit surrogate pair in JS.
    expect(canonicalize('\uD83D\uDE00')).toBe('"\uD83D\uDE00"');
  });

  // -----------------------------------------------------------------------
  // 3. Arrays
  // -----------------------------------------------------------------------

  it('empty array', () => {
    expect(canonicalize([])).toBe('[]');
  });

  it('flat number array preserves order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('mixed type array', () => {
    expect(canonicalize([1, 'two', null, true, false])).toBe('[1,"two",null,true,false]');
  });

  it('nested array', () => {
    expect(canonicalize([[1, 2], [3, 4]])).toBe('[[1,2],[3,4]]');
  });

  // -----------------------------------------------------------------------
  // 4. Objects — sorted keys, no whitespace
  // -----------------------------------------------------------------------

  it('empty object', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('single-key object', () => {
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
  });

  it('keys sorted lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('lexicographic sort: numeric-string keys sort as strings', () => {
    expect(canonicalize({ '10': 'ten', '2': 'two' })).toBe('{"10":"ten","2":"two"}');
  });

  it('lexicographic sort: uppercase before lowercase (UTF-16 order)', () => {
    expect(canonicalize({ b: 1, A: 2 })).toBe('{"A":2,"b":1}');
  });

  it('lexicographic sort: keys with multibyte chars', () => {
    expect(canonicalize({ b: 1, ä: 2 })).toBe('{"b":1,"ä":2}');
  });

  it('nested object sorts at every level', () => {
    expect(canonicalize({ b: { y: 1, x: 2 }, a: { z: 0 } })).toBe(
      '{"a":{"z":0},"b":{"x":2,"y":1}}',
    );
  });

  it('object literal insertion order does not affect output', () => {
    const a = canonicalize({ x: 1, y: 2, z: 3 });
    const b = canonicalize({ z: 3, y: 2, x: 1 });
    const c = canonicalize({ y: 2, z: 3, x: 1 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('omits `undefined` object values per JCS (treats as absent)', () => {
    // JS objects can carry `undefined` values; RFC 8785 has no concept of
    // `undefined`. We elide them rather than throw (matches JSON.stringify
    // semantics for top-level keys).
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('arrays with `undefined` elements throw', () => {
    expect(() => canonicalize([1, undefined, 3])).toThrow(/undefined/);
  });

  // -----------------------------------------------------------------------
  // 5. Refusals
  // -----------------------------------------------------------------------

  it('NaN throws', () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
  });

  it('Infinity throws', () => {
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
  });

  it('-Infinity throws', () => {
    expect(() => canonicalize(-Infinity)).toThrow(/non-finite/);
  });

  it('BigInt throws', () => {
    expect(() => canonicalize(BigInt(1))).toThrow(/bigint/);
  });

  it('function throws', () => {
    expect(() => canonicalize(() => 1)).toThrow(/function/);
  });

  it('symbol throws', () => {
    expect(() => canonicalize(Symbol('x'))).toThrow(/symbol/);
  });

  // -----------------------------------------------------------------------
  // 6. SonderEvent-shaped golden cases
  // -----------------------------------------------------------------------

  it('SonderEvent envelope: keys sorted, no whitespace', () => {
    const event = {
      version: '2',
      id: 'evt-1',
      agent_id: 'a',
      task_id: 't',
      timestamp: '2026-05-12T00:00:00Z',
      payload: { input: 'hello' },
      governance: { contract_id: 'c', validated: true },
    };
    const c = canonicalize(event);
    // Quick sanity: agent_id < governance < id < payload < task_id < timestamp < version
    expect(c.indexOf('"agent_id"')).toBeLessThan(c.indexOf('"governance"'));
    expect(c.indexOf('"governance"')).toBeLessThan(c.indexOf('"id"'));
    expect(c.indexOf('"id"')).toBeLessThan(c.indexOf('"payload"'));
    expect(c.indexOf('"payload"')).toBeLessThan(c.indexOf('"task_id"'));
    expect(c.indexOf('"task_id"')).toBeLessThan(c.indexOf('"timestamp"'));
    expect(c.indexOf('"timestamp"')).toBeLessThan(c.indexOf('"version"'));
    expect(c.includes(' ')).toBe(false);
    expect(c.includes('\n')).toBe(false);
  });

  it('SonderEvent with redaction evidence canonicalizes deterministically', () => {
    const event = {
      version: '2',
      id: 'evt-1',
      metadata: {
        redaction: { fields: ['$.payload.email'], count: 1, sensitivityLevel: 'high' },
      },
      payload: null,
    };
    const a = canonicalize(event);
    const b = canonicalize(JSON.parse(JSON.stringify(event)));
    expect(a).toBe(b);
  });
});

describe('hash helpers', () => {
  it('sha256Hex matches a known vector', () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('sha256Hex output is lowercase hex', () => {
    const hex = sha256Hex('arbitrary input');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stripChainFields removes chain_self_hash and signature', () => {
    const e = {
      id: 'x',
      chain_self_hash: 'abc',
      signature: 'sig',
      payload: 1,
    };
    const stripped = stripChainFields(e);
    expect(stripped).toEqual({ id: 'x', payload: 1 });
    // Source is unchanged
    expect(e.chain_self_hash).toBe('abc');
  });

  it('stripSignatureField removes signature only', () => {
    const e = {
      id: 'x',
      chain_self_hash: 'abc',
      signature: 'sig',
    };
    expect(stripSignatureField(e)).toEqual({ id: 'x', chain_self_hash: 'abc' });
  });

  it('chainSelfHash is deterministic for the same event', () => {
    const e = {
      id: 'evt-1',
      version: '2' as const,
      agent_id: 'a',
      task_id: 't',
      timestamp: '2026-05-12T00:00:00Z',
      payload: 'hello',
    };
    const h1 = chainSelfHash(e);
    const h2 = chainSelfHash({ ...e });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chainSelfHash ignores chain_self_hash and signature in the input', () => {
    const base = {
      id: 'evt-1',
      version: '2' as const,
      agent_id: 'a',
      task_id: 't',
      timestamp: '2026-05-12T00:00:00Z',
      payload: 'hello',
    };
    const withGarbage = { ...base, chain_self_hash: 'garbage', signature: 'garbage' };
    expect(chainSelfHash(base)).toBe(chainSelfHash(withGarbage));
  });

  it('chainSelfHash differs when payload differs', () => {
    const a = chainSelfHash({ id: '1', payload: 'a' });
    const b = chainSelfHash({ id: '1', payload: 'b' });
    expect(a).not.toBe(b);
  });

  it('hashEvent alias matches chainSelfHash', () => {
    const e = { id: 'x', payload: { v: 1 } };
    expect(hashEvent(e)).toBe(chainSelfHash(e));
  });
});
