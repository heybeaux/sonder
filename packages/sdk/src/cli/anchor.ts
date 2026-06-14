/**
 * `sonder anchor` CLI (Spec 2 Task 10 / R9).
 *
 * Reads the AuditLog, builds the daily manifest, writes it to the anchor
 * repo, then runs `git add` / `commit` / `tag` / `push`. Idempotent for
 * same-day re-runs.
 *
 * Config (CLI flags override env):
 *   --db <path>                  | (required)
 *   --pub-key <base64>           | (required, OR --pub-key-file)
 *   --pub-key-file <path>
 *   --repo <path>                | SONDER_ANCHOR_REPO
 *   --manifest-path <relpath>    | SONDER_ANCHOR_PATH        (default: anchors)
 *   --remote <name>              | SONDER_ANCHOR_REMOTE      (default: origin)
 *   --date <YYYY-MM-DD>          | (default: today UTC)
 *   --dry-run                    | build + write but skip git
 *
 * Exit codes:
 *   0   success
 *   2   missing data (no v2 agents to anchor)
 *  64   usage error
 *  65   git push failed after 3 retries
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { AuditLog } from '@heybeaux/sonder-core';
import { buildAnchorManifest, serializeAnchorManifest } from '../anchor.js';

interface Args {
  db?: string | undefined;
  pubKey?: string | undefined;
  pubKeyFile?: string | undefined;
  repo?: string | undefined;
  manifestPath?: string | undefined;
  remote?: string | undefined;
  date?: string | undefined;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--db': out.db = argv[++i]; break;
      case '--pub-key': out.pubKey = argv[++i]; break;
      case '--pub-key-file': out.pubKeyFile = argv[++i]; break;
      case '--repo': out.repo = argv[++i]; break;
      case '--manifest-path': out.manifestPath = argv[++i]; break;
      case '--remote': out.remote = argv[++i]; break;
      case '--date': out.date = argv[++i]; break;
      case '--dry-run': out.dryRun = true; break;
      case '-h':
      case '--help': out.help = true; break;
      default:
        process.stderr.write(`unknown flag: ${a}\n`);
        process.exit(64);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      'sonder-anchor — publish a daily anchor manifest to a git repo.',
      '',
      'Usage:',
      '  sonder-anchor --db <path> --pub-key <base64> [--repo <path>] [--date YYYY-MM-DD] [--dry-run]',
      '',
      'Flags:',
      '  --db               path to the SQLite AuditLog (required)',
      '  --pub-key          base64-encoded raw ed25519 public key',
      '  --pub-key-file     file containing the base64 public key',
      '  --repo             anchor repo path (env: SONDER_ANCHOR_REPO)',
      '  --manifest-path    relpath inside repo for manifests (env: SONDER_ANCHOR_PATH, default: anchors)',
      '  --remote           git remote (env: SONDER_ANCHOR_REMOTE, default: origin)',
      '  --date             YYYY-MM-DD (default: today UTC)',
      '  --dry-run          build + write the manifest but skip the git commands',
      '',
      'Exit codes:',
      '  0    success',
      '  2    no v2 agents to anchor',
      '  64   usage error',
      '  65   git push failed after 3 retries',
      '',
    ].join('\n'),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function runGit(repo: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function pushWithRetry(repo: string, remote: string, tag: string, maxAttempts = 3): { ok: boolean; lastErr: string } {
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const branch = runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = branch.stdout.trim() || 'main';
    const r1 = runGit(repo, ['push', remote, branchName]);
    if (!r1.ok) {
      lastErr = `push branch failed (attempt ${attempt}/${maxAttempts}): ${r1.stderr.trim()}`;
      continue;
    }
    const r2 = runGit(repo, ['push', remote, tag, '--force']);
    if (!r2.ok) {
      lastErr = `push tag failed (attempt ${attempt}/${maxAttempts}): ${r2.stderr.trim()}`;
      continue;
    }
    return { ok: true, lastErr: '' };
  }
  return { ok: false, lastErr };
}

export interface AnchorRunResult {
  status: 'success' | 'missing' | 'push-failed' | 'usage-error';
  manifestFile?: string;
  manifestBytes?: number;
  agents?: number;
  tag?: string;
  message?: string;
}

export function run(argv: string[] = process.argv.slice(2)): { exitCode: number; result: AnchorRunResult } {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0, result: { status: 'success', message: 'help' } };
  }
  if (!args.db) {
    process.stderr.write('error: --db is required\n');
    return { exitCode: 64, result: { status: 'usage-error', message: '--db missing' } };
  }
  const pubKey = args.pubKey ?? (args.pubKeyFile ? readFileSync(args.pubKeyFile, 'utf8').trim() : undefined);
  if (!pubKey) {
    process.stderr.write('error: --pub-key or --pub-key-file is required\n');
    return { exitCode: 64, result: { status: 'usage-error', message: 'pub-key missing' } };
  }
  const repo = args.repo ?? process.env['SONDER_ANCHOR_REPO'];
  const manifestRel = args.manifestPath ?? process.env['SONDER_ANCHOR_PATH'] ?? 'anchors';
  const remote = args.remote ?? process.env['SONDER_ANCHOR_REMOTE'] ?? 'origin';
  const date = args.date ?? today();

  if (!args.dryRun && !repo) {
    process.stderr.write('error: --repo (or SONDER_ANCHOR_REPO) is required unless --dry-run\n');
    return { exitCode: 64, result: { status: 'usage-error', message: 'repo missing' } };
  }

  const audit = new AuditLog(args.db);
  let manifestStr: string;
  let agents: number;
  try {
    const manifest = buildAnchorManifest({
      audit,
      publicKey: pubKey,
      generatedAt: nowIso(),
    });
    agents = manifest.entries.length;
    if (agents === 0) {
      process.stderr.write(`MISSING: no v2 agents to anchor in ${args.db}\n`);
      return {
        exitCode: 2,
        result: { status: 'missing', message: 'no v2 agents' },
      };
    }
    manifestStr = serializeAnchorManifest(manifest);
  } finally {
    audit.close();
  }

  // Write the manifest. The path is `<repo>/<manifestRel>/<YYYY-MM-DD>.json`.
  const outDir = args.dryRun
    ? resolve(manifestRel)
    : resolve(repo!, manifestRel);
  const outFile = join(outDir, `${date}.json`);
  mkdirSync(outDir, { recursive: true });

  const overwrite = existsSync(outFile);
  if (overwrite) {
    process.stderr.write(`warning: overwriting existing manifest ${outFile}\n`);
  }
  writeFileSync(outFile, manifestStr, { encoding: 'utf8', mode: 0o644 });
  const bytes = statSync(outFile).size;

  if (args.dryRun) {
    process.stdout.write(`dry-run wrote ${bytes} bytes to ${outFile} (${agents} agents)\n`);
    return {
      exitCode: 0,
      result: { status: 'success', manifestFile: outFile, manifestBytes: bytes, agents, message: 'dry-run' },
    };
  }

  // Ensure outDir is inside a git repo.
  const isRepo = runGit(repo!, ['rev-parse', '--is-inside-work-tree']);
  if (!isRepo.ok) {
    process.stderr.write(`error: ${repo} is not a git repo\n`);
    return { exitCode: 64, result: { status: 'usage-error', message: 'repo not a git workdir' } };
  }

  // git add
  const relFromRepo = outFile.startsWith(resolve(repo!) + '/') ? outFile.slice(resolve(repo!).length + 1) : outFile;
  const add = runGit(repo!, ['add', relFromRepo]);
  if (!add.ok) {
    process.stderr.write(`error: git add failed: ${add.stderr.trim()}\n`);
    return { exitCode: 65, result: { status: 'push-failed', message: add.stderr.trim() } };
  }

  // git commit — may be a no-op if nothing changed (manifest byte-stable).
  const msg = `anchor: ${date} (${agents} agents)`;
  const commit = runGit(repo!, ['commit', '-m', msg]);
  const nothingToCommit = !commit.ok && /nothing to commit/i.test(commit.stdout + commit.stderr);
  if (!commit.ok && !nothingToCommit) {
    process.stderr.write(`error: git commit failed: ${commit.stderr.trim()}\n`);
    return { exitCode: 65, result: { status: 'push-failed', message: commit.stderr.trim() } };
  }

  // git tag — `--force` so same-day re-runs advance the tag (R9 idempotency).
  const tag = `anchor-${date}`;
  const tagRes = runGit(repo!, ['tag', '--force', tag]);
  if (!tagRes.ok) {
    process.stderr.write(`error: git tag failed: ${tagRes.stderr.trim()}\n`);
    return { exitCode: 65, result: { status: 'push-failed', message: tagRes.stderr.trim() } };
  }

  // Push (with up to 3 retries).
  const push = pushWithRetry(repo!, remote, tag);
  if (!push.ok) {
    process.stderr.write(`error: ${push.lastErr}\n`);
    return { exitCode: 65, result: { status: 'push-failed', message: push.lastErr } };
  }

  process.stdout.write(
    `ok anchor=${date} agents=${agents} tag=${tag} bytes=${bytes} file=${outFile}\n`,
  );
  return {
    exitCode: 0,
    result: { status: 'success', manifestFile: outFile, manifestBytes: bytes, agents, tag },
  };
}

declare const require: { main?: unknown } | undefined;
declare const module: unknown;
const isMain =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  (require as { main?: unknown }).main === module;
if (isMain) {
  const { exitCode } = run();
  process.exit(exitCode);
}

// Helpers for outDir resolution in dry-run mode (avoids unused var lint).
void dirname;
