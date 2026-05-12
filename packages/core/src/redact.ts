/**
 * Sonder pre-sign redaction stage (Spec 2 R5; Redaction-Stage spec R2/R4/R5).
 *
 * This file inlines the `redactJson` primitive from @heybeaux/lattice-core
 * v0.4.0 (PR #37, branch `add-l0-conditional-rule-kind`) because that
 * version has not yet been published to the dep tree. Once Lattice v0.4.0
 * publishes, this file should be deleted and `redactJson` re-imported.
 *
 * TODO: replace with @heybeaux/lattice-core import once v0.4.0 publishes.
 * Source: /Users/beauxwalton/Dev/lattice/packages/core/src/events/redact.ts
 *         (commit 4108745 — "refactor(core/redact): extract redactJson primitive (Spec 1 R11)")
 *
 * On top of `redactJson`, this module adds the Sonder-specific glue:
 *
 *   - `DEFAULT_MUST_NOT_REDACT` — Spec 2 R5 / Spec 1 R12 default allowlist.
 *   - `conditionalGovernanceFields(event)` — adds `$.governance.tier` and
 *     `$.governance.evidence` to the allowlist when `tier` is present.
 *   - `redactSonderEvent(event, opts)` — main entry point used by the emit
 *     pipeline. Returns `{ redacted, evidence }` where `evidence` is the
 *     `metadata.redaction` block Sonder writes onto the v2 event.
 *   - `RedactionRefusedError` — thrown when a must-not-redact path was
 *     about to be redacted. Carries `code:'must-not-redact-field-missing'`
 *     plus the offending path.
 *
 * The redactor MUST NOT see the v2 chain/signature fields — those are
 * added downstream by the chain writer. Sonder hands `redactJson` the
 * pre-chain event shape.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SensitivityLevel = 'low' | 'medium' | 'high';

/** Options for the inlined {@link redactJson} primitive. */
export interface RedactJsonOptions {
  sensitivityLevel: SensitivityLevel;
  mustNotRedact?: readonly string[];
  placeholder?: string;
  additionalKeyNames?: readonly string[];
}

/** Result shape from {@link redactJson}. */
export interface RedactJsonResult {
  redacted: unknown;
  fields: string[];
  refusalPath?: string;
}

/**
 * Sensitive credential-key pattern. Anchored case-insensitively. Mirrors
 * Lattice's SENSITIVE_KEY_PATTERN byte-for-byte (issue #7 / SEC-005).
 */
const SENSITIVE_KEY_PATTERN =
  /^(api[_-]?key|secret|secret[_-]?key|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|authorization|auth|cookie|set[_-]?cookie|session[_-]?id|client[_-]?secret|private[_-]?key|connection[_-]?string|conn[_-]?str|mongo[_-]?uri|db[_-]?password|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|x[_-]?api[_-]?key)$/;

/**
 * Known secret-token formats. Applied to every string in the tree at all
 * sensitivity levels.
 */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  /\bgh[osu]_[A-Za-z0-9]{36}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bsk-ant-[A-Za-z0-9_-]+\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  /\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]+\b/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const PHONE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
];

const SSN_PATTERNS: ReadonlyArray<RegExp> = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?!000|666|9\d{2})\d{9}\b/g,
];

const CREDIT_CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;

/**
 * Inlined `redactJson` primitive. See file header for provenance.
 * Behavior: mirrors Lattice v0.4.0 byte-for-byte.
 */
export function redactJson(tree: unknown, opts: RedactJsonOptions): RedactJsonResult {
  const sensitivity = opts.sensitivityLevel;
  const placeholder = opts.placeholder ?? '[REDACTED]';
  const additionalKeyNames = opts.additionalKeyNames ?? [];
  const mustNotRedact = new Set(opts.mustNotRedact ?? []);
  const additionalKeySet = new Set(additionalKeyNames.map((k) => k.toLowerCase()));

  const cloned: unknown = tree === undefined ? undefined : JSON.parse(JSON.stringify(tree));

  const fields: string[] = [];
  const refusal: { path?: string } = {};

  if (cloned === undefined) {
    return { redacted: cloned, fields };
  }

  walkKeyName(cloned, '$', additionalKeySet, placeholder, mustNotRedact, fields, refusal);
  if (refusal.path) return { redacted: cloned, fields, refusalPath: refusal.path };

  for (const pattern of SECRET_PATTERNS) {
    walkPattern(cloned, '$', pattern, placeholder, mustNotRedact, fields, refusal);
    if (refusal.path) return { redacted: cloned, fields, refusalPath: refusal.path };
  }

  if (sensitivity === 'medium' || sensitivity === 'high') {
    walkPattern(cloned, '$', EMAIL_PATTERN, placeholder, mustNotRedact, fields, refusal);
    if (refusal.path) return { redacted: cloned, fields, refusalPath: refusal.path };
  }

  if (sensitivity === 'high') {
    for (const pattern of PHONE_PATTERNS) {
      walkPattern(cloned, '$', pattern, placeholder, mustNotRedact, fields, refusal);
      if (refusal.path) return { redacted: cloned, fields, refusalPath: refusal.path };
    }
    for (const pattern of SSN_PATTERNS) {
      walkPattern(cloned, '$', pattern, placeholder, mustNotRedact, fields, refusal);
      if (refusal.path) return { redacted: cloned, fields, refusalPath: refusal.path };
    }
    walkPattern(cloned, '$', CREDIT_CARD_PATTERN, placeholder, mustNotRedact, fields, refusal);
    if (refusal.path) return { redacted: cloned, fields, refusalPath: refusal.path };
  }

  return { redacted: cloned, fields };
}

function joinKey(parent: string, key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `${parent}.${key}`;
  return `${parent}['${key}']`;
}

function joinIndex(parent: string, idx: number): string {
  return `${parent}[${idx}]`;
}

function walkKeyName(
  node: unknown,
  path: string,
  additional: ReadonlySet<string>,
  placeholder: string,
  mustNotRedact: ReadonlySet<string>,
  fields: string[],
  refusal: { path?: string },
): void {
  if (refusal.path) return;
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkKeyName(node[i], joinIndex(path, i), additional, placeholder, mustNotRedact, fields, refusal);
      if (refusal.path) return;
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (refusal.path) return;
    const lower = key.toLowerCase();
    const childPath = joinKey(path, key);
    if (SENSITIVE_KEY_PATTERN.test(lower) || additional.has(lower)) {
      if (mustNotRedact.has(childPath)) {
        refusal.path = childPath;
        return;
      }
      obj[key] = placeholder;
      fields.push(childPath);
      continue;
    }
    const value = obj[key];
    if (value !== null && typeof value === 'object') {
      walkKeyName(value, childPath, additional, placeholder, mustNotRedact, fields, refusal);
    }
  }
}

function walkPattern(
  node: unknown,
  path: string,
  pattern: RegExp,
  placeholder: string,
  mustNotRedact: ReadonlySet<string>,
  fields: string[],
  refusal: { path?: string },
): void {
  if (refusal.path) return;
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (refusal.path) return;
      const v = node[i];
      const childPath = joinIndex(path, i);
      if (typeof v === 'string') {
        pattern.lastIndex = 0;
        if (pattern.test(v)) {
          if (mustNotRedact.has(childPath)) {
            refusal.path = childPath;
            return;
          }
          pattern.lastIndex = 0;
          node[i] = v.replace(pattern, placeholder);
          fields.push(childPath);
        }
      } else if (v !== null && typeof v === 'object') {
        walkPattern(v, childPath, pattern, placeholder, mustNotRedact, fields, refusal);
      }
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (refusal.path) return;
    const value = obj[key];
    const childPath = joinKey(path, key);

    if (typeof value === 'string') {
      pattern.lastIndex = 0;
      if (pattern.test(value)) {
        if (mustNotRedact.has(childPath)) {
          refusal.path = childPath;
          return;
        }
        pattern.lastIndex = 0;
        obj[key] = value.replace(pattern, placeholder);
        fields.push(childPath);
      }
    } else if (typeof value === 'object' && value !== null) {
      walkPattern(value, childPath, pattern, placeholder, mustNotRedact, fields, refusal);
    }
  }
}

// ===========================================================================
// Sonder-specific glue
// ===========================================================================

/**
 * Default `mustNotRedact` allowlist for the Sonder redactor — Spec 2 R5
 * (Redaction-Stage spec R4). Audit-critical fields that MUST survive
 * redaction. Removing entries from this set is rejected by the runtime
 * config validator (Spec 2 R8 — override safety).
 */
export const DEFAULT_MUST_NOT_REDACT: readonly string[] = [
  '$.id',
  '$.agent_id',
  '$.task_id',
  '$.timestamp',
  '$.version',
  '$.governance.contract_id',
  '$.governance.validated',
  '$.governance.l1_pass',
  '$.governance.l2_pass',
  '$.governance.l3_pass',
  '$.governance.circuit_state',
  '$.reasoning.consensus',
  '$.reasoning.osi',
  '$.reasoning.rounds',
  '$.intent.action',
  '$.intent.step_trace_id',
];

/**
 * Conditional allowlist entries: `$.governance.tier` and
 * `$.governance.evidence` MUST survive redaction IFF `$.governance.tier`
 * is set on the input event (Spec 2 R13). For non-Lattice emitters where
 * both fields are absent, they are NOT added to the allowlist.
 */
export function conditionalGovernanceFields(event: Record<string, unknown>): string[] {
  const gov = event['governance'] as Record<string, unknown> | undefined;
  if (gov && typeof gov['tier'] === 'string' && gov['tier'].length > 0) {
    return ['$.governance.tier', '$.governance.evidence'];
  }
  return [];
}

/**
 * Thrown when the redactor refused to mask a `mustNotRedact` field, or
 * when a `mustNotRedact` field is null/missing after redaction. The error
 * message includes the offending JSONPath.
 */
export class RedactionRefusedError extends Error {
  override readonly name = 'RedactionRefusedError';
  readonly code = 'must-not-redact-field-missing';
  readonly path: string;
  constructor(path: string) {
    super(`must-not-redact-field-missing:${path}`);
    this.path = path;
  }
}

export interface RedactSonderEventOptions {
  /** Default `'high'` per Spec 2 R3. */
  sensitivityLevel?: SensitivityLevel;
  /**
   * Additional must-not-redact paths to AND with `DEFAULT_MUST_NOT_REDACT`.
   * Operators can extend the allowlist but cannot remove default entries
   * (R8 override safety) — the runtime config layer enforces that;
   * `redactSonderEvent` is the inner primitive that trusts its caller.
   */
  mustNotRedact?: readonly string[];
}

export interface RedactionEvidenceBlock {
  fields: string[];
  count: number;
  sensitivityLevel: SensitivityLevel;
}

export interface RedactSonderEventResult {
  redacted: Record<string, unknown>;
  evidence: RedactionEvidenceBlock;
}

/**
 * Read a JSONPath against a tree. Supports the same subset as the L0
 * allowlist: `$`, `.name`, `['name']`, `[idx]`. Returns `undefined` when
 * the path cannot be resolved.
 */
function resolveJsonPath(tree: unknown, path: string): unknown {
  if (path === '$') return tree;
  if (!path.startsWith('$')) return undefined;
  let cur: unknown = tree;
  let i = 1;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      // dot-name
      let j = i + 1;
      while (j < path.length && /[A-Za-z0-9_]/.test(path[j] ?? '')) j++;
      const name = path.slice(i + 1, j);
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[name];
      i = j;
    } else if (ch === '[') {
      const end = path.indexOf(']', i);
      if (end === -1) return undefined;
      const inner = path.slice(i + 1, end);
      if (cur === null || typeof cur !== 'object') return undefined;
      if (inner.startsWith("'") && inner.endsWith("'")) {
        const name = inner.slice(1, -1);
        cur = (cur as Record<string, unknown>)[name];
      } else {
        const idx = Number(inner);
        if (!Array.isArray(cur)) return undefined;
        cur = cur[idx];
      }
      i = end + 1;
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Run the Sonder redactor over the pre-chain event. Throws
 * `RedactionRefusedError` when:
 *
 *   1. `redactJson` short-circuited because a `mustNotRedact` field would
 *      have been redacted (the primitive's `refusalPath`).
 *   2. Post-redaction, any allowlisted path resolves to null or undefined.
 *
 * On success returns the redacted event + the `metadata.redaction` block
 * the caller should attach to the v2 envelope.
 */
export function redactSonderEvent(
  event: Record<string, unknown>,
  options: RedactSonderEventOptions = {},
): RedactSonderEventResult {
  const sensitivityLevel = options.sensitivityLevel ?? 'high';
  const conditional = conditionalGovernanceFields(event);
  const operatorAdds = options.mustNotRedact ?? [];

  // Compose the effective allowlist; dedupe preserves stable iteration.
  const allowlist = Array.from(
    new Set<string>([...DEFAULT_MUST_NOT_REDACT, ...conditional, ...operatorAdds]),
  );

  const result = redactJson(event, {
    sensitivityLevel,
    mustNotRedact: allowlist,
  });

  if (result.refusalPath !== undefined) {
    throw new RedactionRefusedError(result.refusalPath);
  }

  const redacted = result.redacted as Record<string, unknown>;

  // Post-redaction: every allowlisted path MUST resolve to a non-null, non-
  // undefined value. R5 / R12 — audit-critical fields cannot vanish.
  for (const path of allowlist) {
    const v = resolveJsonPath(redacted, path);
    if (v === null || v === undefined) {
      throw new RedactionRefusedError(path);
    }
  }

  return {
    redacted,
    evidence: {
      fields: result.fields,
      count: result.fields.length,
      sensitivityLevel,
    },
  };
}

/**
 * Validate an operator-supplied `mustNotRedact` allowlist. Operators may
 * provide a FULL replacement; this validator checks that every entry in
 * {@link DEFAULT_MUST_NOT_REDACT} is still present. Spec 2 R8 — override
 * safety: operators cannot remove default entries; attempting to do so
 * throws at runtime construction.
 *
 * Returns the validated allowlist (operator's list, untouched) on
 * success.
 */
export function validateMustNotRedactOverride(operatorAllowlist: readonly string[]): readonly string[] {
  const supplied = new Set(operatorAllowlist);
  for (const required of DEFAULT_MUST_NOT_REDACT) {
    if (!supplied.has(required)) {
      throw new Error(
        `must-not-redact override removed required path: ${required}`,
      );
    }
  }
  return operatorAllowlist;
}
