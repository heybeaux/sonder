/**
 * GIN-19 — SSL Certificate Validation Audit
 *
 * Ensures no source file in the monorepo disables TLS/SSL certificate
 * validation. Checks for:
 *
 *   1. `rejectUnauthorized: false`  — disables cert validation on HTTPS agents
 *   2. `NODE_TLS_REJECT_UNAUTHORIZED=0` or `="0"` — process-level TLS bypass
 *   3. `strictSSL: false`           — axios / request-style option
 *   4. Plain `http://` URLs in service client code (non-localhost, non-test)
 *
 * These checks scan all TypeScript/JavaScript source files in the monorepo's
 * packages/ and adapters/ directories. The following are intentionally excluded:
 *
 *   - node_modules/   (third-party code)
 *   - dist/           (compiled output — check source, not output)
 *   - *.test.ts / *.spec.ts  (test fixtures may reference patterns as strings)
 *   - .turbo/ / .git/ / coverage/
 *   - pnpm-lock.yaml, package-lock.json
 *
 * If a self-signed CA cert is needed for a specific environment, supply it via:
 *   new https.Agent({ ca: fs.readFileSync(caPath) })
 * and gate behind a documented env variable. Never use rejectUnauthorized: false.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname equivalent for ESM: packages/core/src/__tests__
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Repo root: go up 4 levels from __tests__ -> src -> core -> packages -> repo
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

// Only scan production source directories; skip examples and docs
const SCAN_DIRS = [
  join(REPO_ROOT, 'packages'),
  join(REPO_ROOT, 'adapters'),
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mts', '.mjs', '.cjs', '.cts']);

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  '.git',
  'coverage',
  '__pycache__',
]);

const EXCLUDED_FILE_SUFFIXES = [
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.spec.js',
  // This file itself — references the forbidden patterns in comment strings
  'ssl-validation.test.ts',
];

/** Recursively collect source files under `dir`, respecting exclusions. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (st.isFile()) {
      if (!SOURCE_EXTENSIONS.has(extname(entry))) continue;
      if (EXCLUDED_FILE_SUFFIXES.some((suf) => full.endsWith(suf))) continue;
      results.push(full);
    }
  }
  return results;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

/**
 * Scan `content` line-by-line for forbidden patterns.
 * Lines that are pure comments (// or * or block comment) are skipped
 * so documentation references to patterns don't trigger false positives.
 */
function scanContent(
  filePath: string,
  content: string,
  patterns: Array<{ label: string; re: RegExp }>,
): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trimStart();
    // Skip pure comment lines
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      continue;
    }

    for (const { label, re } of patterns) {
      if (re.test(line)) {
        violations.push({
          file: relative(REPO_ROOT, filePath),
          line: i + 1,
          text: trimmed,
          pattern: label,
        });
      }
    }
  }

  return violations;
}

const SSL_BYPASS_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: 'rejectUnauthorized: false',
    re: /rejectUnauthorized\s*:\s*false/,
  },
  {
    label: 'NODE_TLS_REJECT_UNAUTHORIZED assigned "0"',
    // Catches: process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    //          process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = "0"
    re: /NODE_TLS_REJECT_UNAUTHORIZED['"\]]*\s*=\s*['"]?0['"]?/,
  },
  {
    label: 'strictSSL: false',
    re: /strictSSL\s*:\s*false/,
  },
];

const PLAIN_HTTP_URL_PATTERN: Array<{ label: string; re: RegExp }> = [
  {
    label: 'plain http:// URL (non-local)',
    // Matches http:// URLs that are not localhost/127.0.0.1/0.0.0.0/::1
    re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"`\s]+['"`]/,
  },
];

describe('GIN-19: SSL certificate validation audit', () => {
  const sourceFiles = SCAN_DIRS.flatMap(collectSourceFiles);

  it('collected source files from packages/ and adapters/ (sanity)', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('no source file disables SSL cert validation (rejectUnauthorized / NODE_TLS_REJECT_UNAUTHORIZED / strictSSL)', () => {
    const allViolations: Violation[] = [];

    for (const file of sourceFiles) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      allViolations.push(...scanContent(file, content, SSL_BYPASS_PATTERNS));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  [${v.pattern}] ${v.file}:${v.line}\n    ${v.text}`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} SSL bypass violation(s):\n${report}\n\n` +
          'Fix: remove the bypass. For self-signed CAs in controlled environments,\n' +
          'construct an https.Agent({ ca: fs.readFileSync(caPath) }) and gate it\n' +
          'behind a documented env variable such as SSL_CA_PATH.',
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('no source file uses a plain http:// URL for a non-local service endpoint', () => {
    const allViolations: Violation[] = [];

    for (const file of sourceFiles) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      allViolations.push(...scanContent(file, content, PLAIN_HTTP_URL_PATTERN));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  [${v.pattern}] ${v.file}:${v.line}\n    ${v.text}`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} plain http:// URL(s) in service client code:\n${report}\n\n` +
          'Fix: use https:// for all non-local service endpoints.',
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('NODE_TLS_REJECT_UNAUTHORIZED env var is not set to "0" at test startup', () => {
    // Catches the case where a module sets this var during import-time side effects.
    expect(process.env['NODE_TLS_REJECT_UNAUTHORIZED']).not.toBe('0');
  });
});
