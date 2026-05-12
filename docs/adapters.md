# Adapters

Each Sonder adapter bridges one cognitive package to the SonderEvent envelope. Adapters implement two methods:

- **`contribute(event)`** — called before emission. Fill in your faculty's section of the event and return the updated partial.
- **`observe(event)`** — called after emission. React to the fully-assembled event (e.g., update internal state, close feedback loops). Fire-and-forget — errors here don't block emission.

All six adapters ship in this repo. Each uses an **injected callback pattern** — you pass functions that read from your live package instances. This keeps adapters decoupled from any specific package version or transport.

---

## LatticeAdapter

Fills `event.governance` from a Lattice StateContract and circuit breaker.

```typescript
import { LatticeAdapter } from '@heybeaux/sonder-adapter-lattice';

new LatticeAdapter({
  // Return the active StateContract, or null if none
  getContract(): StateContract | null,

  // Return the current circuit breaker state (default: 'closed')
  getCircuitState?(): 'closed' | 'open' | 'half-open',

  // Return the last validation result, or null if not yet validated
  getLastValidation?(): {
    validated: boolean;
    l1_pass: boolean;
    l2_pass: boolean;
    l3_pass: boolean;
    violations: string[];
  } | null,
})
```

**What it fills:**

| Field | Source |
|---|---|
| `governance.contract_id` | `contract.id` |
| `governance.validated` | `lastValidation.validated` |
| `governance.l1_pass` | `lastValidation.l1_pass` |
| `governance.l2_pass` | `lastValidation.l2_pass` |
| `governance.l3_pass` | `lastValidation.l3_pass` |
| `governance.violations` | `lastValidation.violations` |
| `governance.circuit_state` | `getCircuitState()` |

---

## EngramAdapter

Fills `event.memory` from the last Engram retrieval result.

```typescript
import { EngramAdapter } from '@heybeaux/sonder-adapter-engram';

new EngramAdapter({
  // Return the last retrieval result, or null if no retrieval has occurred
  getLastRetrieval(): {
    refs: string[];          // memory record IDs consulted
    query?: string;          // semantic query used
    confidence: number;      // ensemble retrieval confidence (0–1)
    dream_cycle?: string;    // consolidation cycle ID if post-dream
  } | null,
})
```

**Wiring to Engram:** Engram is a NestJS service. Call its query service before your agent step and cache the result, then return it from `getLastRetrieval`.

```typescript
// In your agent setup
let lastRetrieval: EngramRetrievalSnapshot | null = null;

const memories = await engramQueryService.query({ query: 'topic context', limit: 5 });
lastRetrieval = {
  refs: memories.map(m => m.id),
  query: 'topic context',
  confidence: memories.ensembleConfidence,
};

new EngramAdapter({ getLastRetrieval: () => lastRetrieval })
```

---

## ParliamentAdapter

Fills `event.reasoning` from the last Parliament deliberation result.

```typescript
import { ParliamentAdapter } from '@heybeaux/sonder-adapter-parliament';

new ParliamentAdapter({
  getLastDeliberation(): {
    model: string;          // primary model used
    neurotypes: string[];   // active neurotype IDs
    consensus: boolean;     // whether all neurotypes agreed
    dissent: string[];      // neurotype IDs that dissented
    osi: number;            // Opinion Shift Index (0–1)
    rounds: number;         // deliberation rounds taken
  } | null,
})
```

**Wiring to Parliament:** After `runTopology()` resolves, map the `DeliberationResult`:

```typescript
const result = await runTopology({ topic, config });

new ParliamentAdapter({
  getLastDeliberation: () => ({
    model: result.turns[0]?.model ?? '',
    neurotypes: [...new Set(result.turns.map(t => t.neurotype))],
    consensus: result.resolved,
    dissent: result.turns.filter(t => t.osi_score && t.osi_score < 0.15).map(t => t.neurotype),
    osi: result.turns.at(-1)?.osi_score ?? 0,
    rounds: result.totalRounds,
  }),
})
```

---

## AcrAdapter

Fills `event.capabilities` from the ACR capability registry.

```typescript
import { AcrAdapter } from '@heybeaux/sonder-adapter-acr';

new AcrAdapter({
  getCapabilities(): {
    mounted: string[];
    resolution: Record<string, 'index' | 'summary' | 'standard' | 'deep'>;
    budget_used: number;
    budget_limit: number;
  } | null,
})
```

**Wiring to ACR:** Read from `ContextManager` after capabilities are mounted:

```typescript
new AcrAdapter({
  getCapabilities: () => ({
    mounted: contextManager.mountedCapabilities().map(c => c.name),
    resolution: Object.fromEntries(contextManager.mountedCapabilities().map(c => [c.name, c.resolution])),
    budget_used: contextManager.budgetUsed(),
    budget_limit: contextManager.budgetLimit(),
  }),
})
```

---

## LewmAdapter

Fills `event.prediction` from a LeWM world model prediction. Also observes governance outcomes from the bus to update its world model — LeWM is the hypothesis generator; when it sees whether a governance check passed or failed, it can update its Beta distribution parameters accordingly.

```typescript
import { LewmAdapter } from '@heybeaux/sonder-adapter-lewm';

new LewmAdapter({
  getCurrentPrediction(): {
    outcome: string;      // predicted outcome label
    confidence: number;   // Bayesian Beta mean (0–1)
    alpha: number;        // Beta distribution alpha (successes)
    beta: number;         // Beta distribution beta (failures)
    model_id: string;     // model that produced this prediction
  } | null,

  // Optional. Called after every event that carries a governance result.
  // Increment alpha on pass, beta on fail to update your Beta distribution.
  onGovernanceOutcome?(
    outcome: 'pass' | 'fail',
    violations: string[],
    event: SonderEvent,
  ): void,
})
```

```typescript
let alpha = 1;
let beta = 1;

new LewmAdapter({
  getCurrentPrediction: () => predictionService.latest(),
  onGovernanceOutcome: (outcome) => {
    if (outcome === 'pass') alpha++;
    else beta++;
    predictionService.updateBeliefs({ alpha, beta });
  },
})
```

**Note:** `heybeaux/le-wm` is a PyTorch research repo. Build a TypeScript prediction service on top of it and wire the result here.

---

## AwmAdapter

Fills `event.intent` from AWM's Oracle prediction for the current step. Also observes step outcomes from the bus to score LeWM's predictions — AWM is the calibration layer that records whether structural predictions held up against actual governance results, updating its frequency model over time.

```typescript
import { AwmAdapter } from '@heybeaux/sonder-adapter-awm';

new AwmAdapter({
  getCurrentIntent(): {
    action: string;              // step type being executed
    step_trace_id: string;       // AWM StepTrace traceId
    skipped: boolean;            // whether AWM recommended skipping
    skip_reason?: string;        // reason for skip
    constraint_injected: boolean; // whether approval gate pre-injected constraints
  } | null,

  // Optional. Called after every event that carries both a step_trace_id and a
  // governance result. Use this to record the trace outcome back into AWM.
  onStepOutcome?(
    stepTraceId: string,
    outcome: 'pass' | 'fail',
    event: SonderEvent,
  ): void,
})
```

**Wiring to AWM:** Call `oracle.predict()` before the step, then let `onStepOutcome` close the loop automatically:

```typescript
const prediction = await oracle.predict({ stepType: 'draft', profileSlug: 'beaux' });
const traceId = ulid();

new AwmAdapter({
  getCurrentIntent: () => ({
    action: 'draft',
    step_trace_id: traceId,
    skipped: prediction.skipRecommendation,
    skip_reason: prediction.skipRecommendation ? prediction.reasoning : undefined,
    constraint_injected: prediction.constraints.length > 0,
  }),
  onStepOutcome: (id, outcome) => {
    oracle.recordTrace({ traceId: id, stepType: 'draft', passed: outcome === 'pass' });
  },
})
```

---

## Writing a Custom Adapter

Implement `SonderAdapter` from `@heybeaux/sonder-core`:

```typescript
import type { SonderAdapter, SonderEvent } from '@heybeaux/sonder-core';

export class MyAdapter implements SonderAdapter {
  readonly name = 'my-package';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // Read from your package's current state
    const myData = await myPackage.getCurrentState();

    // Fill in whichever SonderEvent field you own
    return {
      ...event,
      metadata: {
        ...event.metadata,
        my_package: myData,
      },
    };
  }

  async observe(event: SonderEvent): Promise<void> {
    // Optional: react to the fully-assembled event
    // e.g., update internal models based on governance violations
    if (event.governance.violations.length > 0) {
      await myPackage.recordViolations(event.governance.violations);
    }
  }
}
```

**Rules:**
- `contribute()` must be synchronous-safe (no long-running I/O). Read from in-memory state, not from a remote service.
- `observe()` is fire-and-forget. Errors here are swallowed — never throw from `observe()`.
- Never modify the event's `id`, `version`, `agent_id`, `task_id`, or `timestamp` fields.
- Return `{ ...event, yourField: value }` — always spread the incoming partial.
