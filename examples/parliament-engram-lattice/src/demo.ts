/**
 * Sonder End-to-End Demo: Parliament + Engram + Lattice
 *
 * Simulates a 3-agent content pipeline:
 *   1. Research Agent  — deliberates on topic research
 *   2. Draft Agent     — deliberates on content drafting
 *   3. Approval Agent  — deliberates on quality approval
 *
 * Each step emits a SonderEvent carrying full cognitive context from all
 * three adapters. The audit log is queried at the end to demonstrate
 * the compliance story.
 */

import {
  SonderBus,
  type SonderEvent,
} from '@sonder/core';
import { LatticeAdapter, type LatticeValidationSnapshot } from '@sonder/adapter-lattice';
import { EngramAdapter, type EngramRetrievalSnapshot } from '@sonder/adapter-engram';
import { ParliamentAdapter, type ParliamentDeliberationSnapshot } from '@sonder/adapter-parliament';
import type { StateContract } from '@heybeaux/lattice-core';

// ─── Simulation State ──────────────────────────────────────────────────────────
// In a real integration these would come from live Lattice/Engram/Parliament
// instances. Here we simulate realistic snapshots to demonstrate the event bus.

interface AgentStep {
  name: string;
  agentId: string;
  taskId: string;
  action: string;
  contract: Partial<StateContract>;
  validation: LatticeValidationSnapshot;
  retrieval: EngramRetrievalSnapshot;
  deliberation: ParliamentDeliberationSnapshot;
}

const PIPELINE: AgentStep[] = [
  {
    name: 'Research Agent',
    agentId: 'agent:research',
    taskId: 'task:linkedin-post-2026-05-09',
    action: 'research_topic',
    contract: {
      id: '01HZ8RESEARCH001',
      schemaVersion: '0.1.0',
      traceId: 'trace:linkedin-post-2026-05-09',
    } as Partial<StateContract>,
    validation: {
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: true,
      violations: [],
    },
    retrieval: {
      refs: ['mem:beaux-voice-001', 'mem:linkedin-best-practices-003'],
      query: 'Beaux Walton writing style and LinkedIn content preferences',
      confidence: 0.91,
    },
    deliberation: {
      model: 'claude-opus-4-7',
      neurotypes: ['empiricist', 'skeptic', 'synthesizer'],
      consensus: true,
      dissent: [],
      osi: 0.38,
      rounds: 2,
    },
  },
  {
    name: 'Draft Agent',
    agentId: 'agent:draft',
    taskId: 'task:linkedin-post-2026-05-09',
    action: 'draft_post',
    contract: {
      id: '01HZ8DRAFT002',
      schemaVersion: '0.1.0',
      traceId: 'trace:linkedin-post-2026-05-09',
    } as Partial<StateContract>,
    validation: {
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: false,
      violations: ['L3_CONFIDENCE_MARGINAL'],
    },
    retrieval: {
      refs: ['mem:beaux-voice-001', 'mem:sonder-announcement-draft-007'],
      query: 'previous LinkedIn post drafts and tone examples',
      confidence: 0.84,
      dream_cycle: 'consolidation:2026-05-09T02:00:00Z',
    },
    deliberation: {
      model: 'claude-opus-4-7',
      neurotypes: ['empiricist', 'contrarian', 'synthesizer'],
      consensus: false,
      dissent: ['contrarian'],
      osi: 0.12,
      rounds: 4,
    },
  },
  {
    name: 'Approval Agent',
    agentId: 'agent:approval',
    taskId: 'task:linkedin-post-2026-05-09',
    action: 'approve_post',
    contract: {
      id: '01HZ8APPROVAL003',
      schemaVersion: '0.1.0',
      traceId: 'trace:linkedin-post-2026-05-09',
    } as Partial<StateContract>,
    validation: {
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: true,
      violations: [],
    },
    retrieval: {
      refs: ['mem:approval-criteria-002'],
      query: 'LinkedIn post approval criteria and brand guidelines',
      confidence: 0.96,
    },
    deliberation: {
      model: 'claude-sonnet-4-6',
      neurotypes: ['empiricist', 'synthesizer'],
      consensus: true,
      dissent: [],
      osi: 0.55,
      rounds: 1,
    },
  },
];

// ─── Demo ──────────────────────────────────────────────────────────────────────

async function runDemo() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sonder E2E Demo — Parliament + Engram + Lattice             ║');
  console.log('║  Pipeline: Research → Draft → Approval                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Each agent gets its own bus instance with its own adapter state.
  // In production each would be a separate process/service.
  const events: SonderEvent[] = [];

  for (const step of PIPELINE) {
    console.log(`▶ ${step.name} (${step.action})`);

    // Adapters are stateless callbacks — the "state" is whatever the
    // real Lattice/Engram/Parliament instances hold at this moment.
    const bus = new SonderBus();

    bus.register(new LatticeAdapter({
      getContract: () => step.contract as StateContract,
      getCircuitState: () => 'closed',
      getLastValidation: () => step.validation,
    }));

    bus.register(new EngramAdapter({
      getLastRetrieval: () => step.retrieval,
    }));

    bus.register(new ParliamentAdapter({
      getLastDeliberation: () => step.deliberation,
    }));

    const event = await bus.emit({
      agent_id: step.agentId,
      task_id: step.taskId,
      payload: { action: step.action },
    });

    events.push(event);

    // Print a compact summary of what the event carries
    const gov = event.governance;
    const mem = event.memory;
    const rea = event.reasoning;

    console.log(`  governance  contract=${gov.contract_id} validated=${gov.validated} l3=${gov.l3_pass} violations=[${gov.violations.join(', ') || 'none'}]`);
    console.log(`  memory      refs=${mem.refs.length} confidence=${mem.confidence.toFixed(2)}${mem.dream_cycle ? ' dream=✓' : ''}`);
    console.log(`  reasoning   model=${rea.model} rounds=${rea.rounds} consensus=${rea.consensus} osi=${rea.osi.toFixed(2)}${rea.dissent.length ? ` dissent=[${rea.dissent.join(', ')}]` : ''}`);
    console.log(`  event.id    ${event.id}\n`);

    bus.close();
  }

  // ─── Audit Log Demo ──────────────────────────────────────────────────────────
  // In production you'd use a single persistent bus across all agents.
  // Here we reconstruct from collected events to show the query interface.

  console.log('─── Audit Log ──────────────────────────────────────────────────');
  console.log(`Total events emitted: ${events.length}`);
  console.log(`Task ID: ${events[0]?.task_id}`);

  const violations = events.filter(e => e.governance.violations.length > 0);
  console.log(`\nEvents with governance violations: ${violations.length}`);
  for (const e of violations) {
    const action = (e.payload as { action: string }).action;
    console.log(`  [${e.id}] ${action} → ${e.governance.violations.join(', ')}`);
  }

  const noConsensus = events.filter(e => !e.reasoning.consensus);
  console.log(`\nEvents without reasoning consensus: ${noConsensus.length}`);
  for (const e of noConsensus) {
    const action = (e.payload as { action: string }).action;
    console.log(`  [${e.id}] ${action} — dissent: [${e.reasoning.dissent.join(', ')}] osi=${e.reasoning.osi.toFixed(2)}`);
  }

  console.log('\n─── Compliance Answers ─────────────────────────────────────────');
  for (const e of events) {
    const action = (e.payload as { action: string }).action;
    console.log(`\n[${action}]`);
    console.log(`  What did the agent know?          refs=${e.memory.refs.join(', ')}`);
    console.log(`  What was it authorized to do?     capabilities.mounted=${JSON.stringify(e.capabilities?.mounted ?? [])}`);
    console.log(`  Why did it decide what it decided? consensus=${e.reasoning.consensus} model=${e.reasoning.model} rounds=${e.reasoning.rounds}`);
    console.log(`  Was the handoff valid?             validated=${e.governance.validated} violations=${JSON.stringify(e.governance.violations)}`);
    console.log(`  What did it predict?               outcome=${e.prediction?.outcome || '(no prediction)'} confidence=${e.prediction?.confidence ?? 0}`);
  }

  console.log('\n✓ Demo complete.');
}

runDemo().catch(console.error);
