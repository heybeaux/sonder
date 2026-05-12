/**
 * Sonder End-to-End Demo: All Six Cognitive Adapters
 *
 * Simulates a 3-agent content pipeline using the Sonder SDK:
 *   1. Research Agent  — retrieves memory, deliberates on topic
 *   2. Draft Agent     — deliberates on content, governance flags marginal L3
 *   3. Approval Agent  — final deliberation and governance sign-off
 *
 * Each agent is wrapped with withSonder() so every step emits before/after
 * events automatically. A single runtime and audit log spans the full pipeline.
 *
 * All six adapters are registered:
 *   ACR        → event.capabilities
 *   Engram     → event.memory
 *   Parliament → event.reasoning
 *   Lattice    → event.governance
 *   LeWM       → event.prediction
 *   AWM        → event.intent
 */

import { createRuntime, withSonder } from '@heybeaux/sonder-sdk';
import { AcrAdapter } from '@heybeaux/sonder-adapter-acr';
import { EngramAdapter, type EngramRetrievalSnapshot } from '@heybeaux/sonder-adapter-engram';
import { ParliamentAdapter, type ParliamentDeliberationSnapshot } from '@heybeaux/sonder-adapter-parliament';
import { LatticeAdapter, type LatticeValidationSnapshot } from '@heybeaux/sonder-adapter-lattice';
import { LewmAdapter, type LeWMPredictionSnapshot } from '@heybeaux/sonder-adapter-lewm';
import { AwmAdapter, type AWMIntentSnapshot } from '@heybeaux/sonder-adapter-awm';
// Minimal StateContract shape — only fields LatticeAdapter reads
interface StateContract { id: string; schemaVersion: string; traceId: string; }

// ─── Mutable adapter state ─────────────────────────────────────────────────────
// In production these would be live instances of each package. Here we swap
// the snapshot before each agent step to simulate per-step cognitive state.

let currentCapabilities = {
  mounted: [] as string[],
  resolution: {} as Record<string, 'index' | 'summary' | 'standard' | 'deep'>,
  budget_used: 0,
  budget_limit: 8000,
};
let currentRetrieval: EngramRetrievalSnapshot | null = null;
let currentDeliberation: ParliamentDeliberationSnapshot | null = null;
let currentContract: StateContract | null = null;
let currentValidation: LatticeValidationSnapshot | null = null;
let currentPrediction: LeWMPredictionSnapshot | null = null;
let currentIntent: AWMIntentSnapshot | null = null;

// LeWM Beta distribution — updated live by the governance observe loop
let lewmAlpha = 1;
let lewmBeta = 1;

// ─── Runtime ───────────────────────────────────────────────────────────────────
// One runtime, one audit log for the full pipeline.

const runtime = createRuntime({
  adapters: [
    new AcrAdapter({
      getCapabilities: () => currentCapabilities,
    }),
    new EngramAdapter({
      getLastRetrieval: () => currentRetrieval,
    }),
    new ParliamentAdapter({
      getLastDeliberation: () => currentDeliberation,
    }),
    new LatticeAdapter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getContract: () => currentContract as any,
      getCircuitState: () => 'closed',
      getLastValidation: () => currentValidation,
    }),
    new LewmAdapter({
      getCurrentPrediction: () => currentPrediction,
      onGovernanceOutcome: (outcome) => {
        if (outcome === 'pass') lewmAlpha++;
        else lewmBeta++;
      },
    }),
    new AwmAdapter({
      getCurrentIntent: () => currentIntent,
      onStepOutcome: (traceId, outcome) => {
        console.log(`  ↺ AWM scored trace ${traceId}: ${outcome} (LeWM Beta now α=${lewmAlpha} β=${lewmBeta})`);
      },
    }),
  ],
});

// ─── Agent functions ───────────────────────────────────────────────────────────

async function researchAgent(input: { topic: string }) {
  return { findings: `Key insights on "${input.topic}": positioning, regulatory context, differentiation.` };
}

async function draftAgent(input: { findings: string }) {
  return { draft: `Draft post based on: ${input.findings.slice(0, 60)}...` };
}

async function approvalAgent(input: { draft: string }) {
  return { approved: true, note: 'Meets brand guidelines and compliance criteria.' };
}

// ─── Wrapped agents ────────────────────────────────────────────────────────────

const TASK_ID = 'task:linkedin-post-2026-05-11';

const tracedResearch = withSonder(researchAgent, {
  runtime,
  agentId: 'agent:research',
  taskId: TASK_ID,
});

const tracedDraft = withSonder(draftAgent, {
  runtime,
  agentId: 'agent:draft',
  taskId: TASK_ID,
});

const tracedApproval = withSonder(approvalAgent, {
  runtime,
  agentId: 'agent:approval',
  taskId: TASK_ID,
});

// ─── Demo ──────────────────────────────────────────────────────────────────────

async function runDemo() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sonder E2E Demo — All Six Adapters via SDK                  ║');
  console.log('║  Pipeline: Research → Draft → Approval                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Step 1: Research ──
  console.log('▶ Research Agent');
  currentCapabilities = { mounted: ['web-search', 'memory-read'], resolution: { 'web-search': 'standard', 'memory-read': 'deep' }, budget_used: 2100, budget_limit: 8000 };
  currentRetrieval = { refs: ['mem:beaux-voice-001', 'mem:linkedin-best-practices-003'], query: 'Beaux Walton writing style and LinkedIn preferences', confidence: 0.91 };
  currentDeliberation = { model: 'claude-opus-4-7', neurotypes: ['empiricist', 'skeptic', 'synthesizer'], consensus: true, dissent: [], osi: 0.38, rounds: 2 };
  currentContract = { id: 'contract:research-v1', schemaVersion: '0.1.0', traceId: 'trace:linkedin-post-2026-05-11' } as unknown as StateContract;
  currentValidation = { validated: true, l1_pass: true, l2_pass: true, l3_pass: true, violations: [] };
  currentPrediction = { outcome: 'handoff_success', confidence: lewmAlpha / (lewmAlpha + lewmBeta), alpha: lewmAlpha, beta: lewmBeta, model_id: 'lewm-v1' };
  currentIntent = { action: 'research_topic', step_trace_id: 'trace:research-001', skipped: false, constraint_injected: false };

  await tracedResearch({ topic: 'Sonder: AI agent cognitive runtime' });
  console.log();

  // ── Step 2: Draft ──
  console.log('▶ Draft Agent');
  currentCapabilities = { mounted: ['content-writer', 'memory-read'], resolution: { 'content-writer': 'deep', 'memory-read': 'standard' }, budget_used: 3750, budget_limit: 8000 };
  currentRetrieval = { refs: ['mem:beaux-voice-001', 'mem:sonder-announcement-draft-007'], query: 'previous LinkedIn post drafts and tone examples', confidence: 0.84, dream_cycle: 'consolidation:2026-05-11T02:00:00Z' };
  currentDeliberation = { model: 'claude-opus-4-7', neurotypes: ['empiricist', 'contrarian', 'synthesizer'], consensus: false, dissent: ['contrarian'], osi: 0.12, rounds: 4 };
  currentContract = { id: 'contract:draft-v1', schemaVersion: '0.1.0', traceId: 'trace:linkedin-post-2026-05-11' } as unknown as StateContract;
  currentValidation = { validated: true, l1_pass: true, l2_pass: true, l3_pass: false, violations: ['L3_CONFIDENCE_MARGINAL'] };
  currentPrediction = { outcome: 'needs_revision', confidence: lewmAlpha / (lewmAlpha + lewmBeta), alpha: lewmAlpha, beta: lewmBeta, model_id: 'lewm-v1' };
  currentIntent = { action: 'draft_post', step_trace_id: 'trace:draft-001', skipped: false, constraint_injected: true };

  await tracedDraft({ findings: 'Key insights on Sonder: positioning, regulatory context, differentiation.' });
  console.log();

  // ── Step 3: Approval ──
  console.log('▶ Approval Agent');
  currentCapabilities = { mounted: ['compliance-check'], resolution: { 'compliance-check': 'standard' }, budget_used: 900, budget_limit: 8000 };
  currentRetrieval = { refs: ['mem:approval-criteria-002'], query: 'LinkedIn post approval criteria and brand guidelines', confidence: 0.96 };
  currentDeliberation = { model: 'claude-sonnet-4-6', neurotypes: ['empiricist', 'synthesizer'], consensus: true, dissent: [], osi: 0.55, rounds: 1 };
  currentContract = { id: 'contract:approval-v1', schemaVersion: '0.1.0', traceId: 'trace:linkedin-post-2026-05-11' } as unknown as StateContract;
  currentValidation = { validated: true, l1_pass: true, l2_pass: true, l3_pass: true, violations: [] };
  currentPrediction = { outcome: 'approved', confidence: lewmAlpha / (lewmAlpha + lewmBeta), alpha: lewmAlpha, beta: lewmBeta, model_id: 'lewm-v1' };
  currentIntent = { action: 'approve_post', step_trace_id: 'trace:approval-001', skipped: false, constraint_injected: false };

  await tracedApproval({ draft: 'Draft post based on: Key insights on Sonder...' });
  console.log();

  // ─── Audit Log ────────────────────────────────────────────────────────────────

  console.log('─── Audit Log ──────────────────────────────────────────────────');
  const allEvents = runtime.bus.query({ task_id: TASK_ID });
  console.log(`Total events: ${allEvents.length} (${allEvents.length / 2} steps × before/after)\n`);

  // withSonder emits before + after per step — use 'after' events for audit
  const stepEvents = allEvents.filter(e => (e.payload as { phase?: string }).phase === 'after');

  const violations = stepEvents.filter(e => e.governance.violations.length > 0);
  console.log(`Governance violations: ${violations.length}`);
  for (const e of violations) {
    console.log(`  [${e.agent_id}] ${e.governance.violations.join(', ')}`);
  }

  const noConsensus = stepEvents.filter(e => !e.reasoning.consensus);
  console.log(`\nReasoning without consensus: ${noConsensus.length}`);
  for (const e of noConsensus) {
    console.log(`  [${e.agent_id}] dissent=[${e.reasoning.dissent.join(', ')}] osi=${e.reasoning.osi.toFixed(2)} rounds=${e.reasoning.rounds}`);
  }

  console.log('\n─── Compliance Answers ─────────────────────────────────────────');
  for (const e of stepEvents) {
    console.log(`\n[${e.agent_id}]`);
    console.log(`  What did it know?              ${e.memory.refs.join(', ')} (confidence=${e.memory.confidence.toFixed(2)})`);
    console.log(`  What was it authorized to do?  ${e.capabilities.mounted.join(', ')}`);
    console.log(`  Why did it decide this?        consensus=${e.reasoning.consensus} model=${e.reasoning.model} rounds=${e.reasoning.rounds}`);
    console.log(`  Was the handoff valid?          validated=${e.governance.validated} violations=${JSON.stringify(e.governance.violations)}`);
    console.log(`  What did it predict?            ${e.prediction.outcome} (confidence=${e.prediction.confidence.toFixed(2)} α=${e.prediction.alpha} β=${e.prediction.beta})`);
    console.log(`  What did it intend?             action=${e.intent.action} skipped=${e.intent.skipped} constraint_injected=${e.intent.constraint_injected}`);
  }

  console.log(`\n─── LeWM Calibration ───────────────────────────────────────────`);
  console.log(`Final Beta: α=${lewmAlpha} β=${lewmBeta} mean=${(lewmAlpha / (lewmAlpha + lewmBeta)).toFixed(3)}`);
  console.log(`Outcomes observed: ${lewmAlpha + lewmBeta - 2} total (${lewmAlpha - 1} pass, ${lewmBeta - 1} fail)`);

  runtime.shutdown();
  console.log('\n✓ Demo complete.');
}

runDemo().catch(console.error);
