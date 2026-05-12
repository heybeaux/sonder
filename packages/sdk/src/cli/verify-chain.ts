/**
 * `sonder verify-chain` CLI (Spec 2 Task 9 / R7).
 *
 * Usage:
 *   sonder-verify-chain --agent-id <id> --db <path> --pub-key <base64>
 *   sonder-verify-chain --agent-id <id> --db <path> --pub-key <base64> --json
 *
 * Exit codes:
 *   0 — pass
 *   1 — mismatch (hash, signature, or chain link)
 *   2 — missing data (no events or no v2 events for the agent)
 *  64 — usage error (bad flags)
 */

import { readFileSync } from 'node:fs';
import { AuditLog } from '@heybeaux/sonder-core';
import { verifyChain, loadPublicKeyFromBase64 } from '../verify-chain.js';

interface ParsedArgs {
  agentId?: string;
  db?: string;
  pubKey?: string;
  pubKeyFile?: string;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--agent-id':
        out.agentId = argv[++i];
        break;
      case '--db':
        out.db = argv[++i];
        break;
      case '--pub-key':
        out.pubKey = argv[++i];
        break;
      case '--pub-key-file':
        out.pubKeyFile = argv[++i];
        break;
      case '--json':
        out.json = true;
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
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
      'sonder-verify-chain — walk and verify a per-agent SonderEvent chain.',
      '',
      'Usage:',
      '  sonder-verify-chain --agent-id <id> --db <path> --pub-key <base64> [--json]',
      '  sonder-verify-chain --agent-id <id> --db <path> --pub-key-file <path> [--json]',
      '',
      'Flags:',
      '  --agent-id        agent_id to verify (required)',
      '  --db              path to the SQLite AuditLog (required)',
      '  --pub-key         base64-encoded raw ed25519 public key',
      '  --pub-key-file    file containing the base64 public key (trimmed)',
      '  --json            emit JSON output (default: human-readable)',
      '',
      'Exit codes:',
      '  0   chain verified',
      '  1   hash/signature/link mismatch',
      '  2   missing data (no events for agent)',
      '  64  usage error',
      '',
    ].join('\n'),
  );
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.agentId || !args.db) {
    process.stderr.write('error: --agent-id and --db are required\n');
    return 64;
  }
  const keyB64 = args.pubKey ?? (args.pubKeyFile ? readFileSync(args.pubKeyFile, 'utf8').trim() : undefined);
  if (!keyB64) {
    process.stderr.write('error: --pub-key or --pub-key-file is required\n');
    return 64;
  }

  let publicKey;
  try {
    publicKey = loadPublicKeyFromBase64(keyB64);
  } catch (err) {
    process.stderr.write(`error: invalid public key: ${(err as Error).message}\n`);
    return 64;
  }

  const audit = new AuditLog(args.db);
  let result;
  try {
    result = verifyChain({ audit, agentId: args.agentId, publicKey });
  } finally {
    audit.close();
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result);
  }

  switch (result.status) {
    case 'pass':
      return 0;
    case 'mismatch':
      return 1;
    case 'missing':
      return 2;
  }
}

function renderHuman(result: ReturnType<typeof verifyChain>): void {
  switch (result.status) {
    case 'pass': {
      for (const w of result.warnings) {
        process.stderr.write(`warning: ${w.message}\n`);
      }
      process.stdout.write(
        `ok  agent=${result.agentId} events=${result.eventsChecked} head=${result.headEventId} head_hash=${result.headChainHash}\n`,
      );
      return;
    }
    case 'mismatch': {
      for (const w of result.warnings) {
        process.stderr.write(`warning: ${w.message}\n`);
      }
      const m = result.mismatch;
      process.stderr.write(
        `FAIL agent=${result.agentId} event=${m.eventId} index=${m.index} check=${m.check}\n`,
      );
      process.stderr.write(`  expected: ${m.expected}\n`);
      process.stderr.write(`  actual:   ${m.actual}\n`);
      process.stderr.write(`  ${m.message}\n`);
      return;
    }
    case 'missing': {
      process.stderr.write(`MISSING agent=${result.agentId}: ${result.reason}\n`);
      return;
    }
  }
}

// Invoke when run directly. tsup bundles this entrypoint as CJS, so we
// rely on `require.main === module` (which the bundler preserves).
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
const isMain =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  (require as { main?: unknown }).main === module;
if (isMain) {
  process.exit(main());
}
