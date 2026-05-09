/**
 * Sonder Performance Benchmarks
 *
 * Targets (from design.md):
 *   p50 emit latency  < 1ms
 *   p99 emit latency  < 5ms
 *   audit log write   > 1,000 events/sec
 *   audit log query   < 50ms (indexed)
 */

import { SonderBus } from '@sonder/core';
import { LatticeAdapter } from '@sonder/adapter-lattice';
import { EngramAdapter } from '@sonder/adapter-engram';
import { ParliamentAdapter } from '@sonder/adapter-parliament';
import type { StateContract } from '@heybeaux/lattice-core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

function pass(label: string, value: number, target: number, unit = 'ms') {
  const ok = value <= target;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label}: ${value.toFixed(3)}${unit}  (target < ${target}${unit})`);
  return ok;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockContract = { id: 'bench-contract-001', schemaVersion: '0.1.0', traceId: 'bench-trace' } as unknown as StateContract;

function makeBus(withAdapters: boolean) {
  const bus = new SonderBus();
  if (withAdapters) {
    bus.register(new LatticeAdapter({
      getContract: () => mockContract,
      getCircuitState: () => 'closed',
      getLastValidation: () => ({ validated: true, l1_pass: true, l2_pass: true, l3_pass: true, violations: [] }),
    }));
    bus.register(new EngramAdapter({
      getLastRetrieval: () => ({ refs: ['mem-001', 'mem-002'], query: 'bench query', confidence: 0.9 }),
    }));
    bus.register(new ParliamentAdapter({
      getLastDeliberation: () => ({
        model: 'claude-opus-4-7',
        neurotypes: ['empiricist', 'skeptic', 'synthesizer'],
        consensus: true,
        dissent: [],
        osi: 0.4,
        rounds: 2,
      }),
    }));
  }
  return bus;
}

// ─── Benchmark 1: Emit latency — no adapters ──────────────────────────────────

async function benchEmitNoAdapters(n: number): Promise<number[]> {
  const bus = makeBus(false);
  const samples: number[] = [];

  // warmup
  for (let i = 0; i < 50; i++) {
    await bus.emit({ agent_id: 'bench', task_id: 'task', payload: null });
  }

  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await bus.emit({ agent_id: 'bench', task_id: 'task', payload: null });
    samples.push(performance.now() - t0);
  }

  bus.close();
  return samples;
}

// ─── Benchmark 2: Emit latency — 3 adapters ───────────────────────────────────

async function benchEmitWithAdapters(n: number): Promise<number[]> {
  const bus = makeBus(true);
  const samples: number[] = [];

  // warmup
  for (let i = 0; i < 50; i++) {
    await bus.emit({ agent_id: 'bench', task_id: 'task', payload: null });
  }

  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await bus.emit({ agent_id: 'bench', task_id: 'task', payload: null });
    samples.push(performance.now() - t0);
  }

  bus.close();
  return samples;
}

// ─── Benchmark 3: Write throughput ────────────────────────────────────────────

async function benchWriteThroughput(n: number): Promise<number> {
  const bus = makeBus(false);

  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    await bus.emit({ agent_id: 'bench', task_id: 'task', payload: { i } });
  }
  const elapsed = performance.now() - t0;

  bus.close();
  return (n / elapsed) * 1000; // events/sec
}

// ─── Benchmark 4: Audit log query latency ─────────────────────────────────────

async function benchQueryLatency(n: number): Promise<number[]> {
  const bus = makeBus(false);

  // seed the log
  for (let i = 0; i < n; i++) {
    await bus.emit({
      agent_id: i % 2 === 0 ? 'agent-a' : 'agent-b',
      task_id: 'task-bench',
      payload: { i },
    });
  }

  const samples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    bus.query({ agent_id: 'agent-a', limit: 50 });
    samples.push(performance.now() - t0);
  }

  bus.close();
  return samples;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const N = 1000;

  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│  Sonder Performance Benchmarks                                  │');
  console.log(`│  N=${N} samples per benchmark, M1/M-series Mac                  │`);
  console.log('└─────────────────────────────────────────────────────────────────┘\n');

  let allPass = true;

  // ── Benchmark 1: No adapters ──
  console.log('1. Emit latency — no adapters');
  {
    const samples = await benchEmitNoAdapters(N);
    const s = stats(samples);
    console.log(`     p50=${s.p50.toFixed(3)}ms  p95=${s.p95.toFixed(3)}ms  p99=${s.p99.toFixed(3)}ms  mean=${s.mean.toFixed(3)}ms`);
    allPass = pass('  p50', s.p50, 1) && allPass;
    allPass = pass('  p99', s.p99, 5) && allPass;
  }

  // ── Benchmark 2: 3 adapters ──
  console.log('\n2. Emit latency — 3 adapters (Lattice + Engram + Parliament)');
  {
    const samples = await benchEmitWithAdapters(N);
    const s = stats(samples);
    console.log(`     p50=${s.p50.toFixed(3)}ms  p95=${s.p95.toFixed(3)}ms  p99=${s.p99.toFixed(3)}ms  mean=${s.mean.toFixed(3)}ms`);
    allPass = pass('  p50', s.p50, 1) && allPass;
    allPass = pass('  p99', s.p99, 5) && allPass;
  }

  // ── Benchmark 3: Write throughput ──
  console.log('\n3. Audit log write throughput');
  {
    const eventsPerSec = await benchWriteThroughput(N);
    const ok = eventsPerSec >= 1000;
    const mark = ok ? '✓' : '✗';
    console.log(`  ${mark} throughput: ${Math.round(eventsPerSec).toLocaleString()} events/sec  (target > 1,000/sec)`);
    allPass = ok && allPass;
  }

  // ── Benchmark 4: Query latency ──
  console.log('\n4. Audit log query latency (1,000 events seeded, 100 queries)');
  {
    const samples = await benchQueryLatency(N);
    const s = stats(samples);
    console.log(`     p50=${s.p50.toFixed(3)}ms  p95=${s.p95.toFixed(3)}ms  p99=${s.p99.toFixed(3)}ms`);
    allPass = pass('  p99', s.p99, 50) && allPass;
  }

  console.log(`\n${allPass ? '✓ All benchmarks passed.' : '✗ One or more benchmarks failed.'}`);

  // Write results to file for tracking
  const results = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    n: N,
  };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    new URL('../../benchmarks/results.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
}

main().catch(console.error);
