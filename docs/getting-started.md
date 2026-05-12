# Getting Started with Sonder

Sonder is the event bus that binds memory, reasoning, governance, capability, and prediction into a unified agent mind. Every agent action emits a typed `SonderEvent` carrying structured context from all six cognitive faculties simultaneously.

This guide gets you from zero to a working integration in under 5 minutes.

## Install

```bash
pnpm add @heybeaux/sonder-core @heybeaux/sonder-sdk
```

Add the adapters for whichever packages you're using:

```bash
pnpm add @heybeaux/sonder-adapter-lattice @heybeaux/sonder-adapter-engram @heybeaux/sonder-adapter-parliament
```

## Quickstart

```typescript
import { createRuntime } from '@heybeaux/sonder-sdk';
import { LatticeAdapter } from '@heybeaux/sonder-adapter-lattice';
import { EngramAdapter } from '@heybeaux/sonder-adapter-engram';
import { ParliamentAdapter } from '@heybeaux/sonder-adapter-parliament';

const runtime = createRuntime({
  dbPath: './audit.db',
  adapters: [
    new LatticeAdapter({
      getContract: () => myLatticeInstance.activeContract(),
      getCircuitState: () => myLatticeInstance.circuitState(),
      getLastValidation: () => myLatticeInstance.lastValidation(),
    }),
    new EngramAdapter({
      getLastRetrieval: () => engramSession.lastRetrieval(),
    }),
    new ParliamentAdapter({
      getLastDeliberation: () => parliament.lastResult(),
    }),
  ],
});

// Emit an event from your agent
const event = await runtime.bus.emit({
  agent_id: 'agent:my-agent',
  task_id: 'task:my-task',
  payload: { action: 'draft_post', input: 'Write about Sonder' },
});

console.log(event.id);              // ULID
console.log(event.governance.validated);  // true/false
console.log(event.memory.refs);     // memory IDs consulted
console.log(event.reasoning.consensus);   // Parliament agreement

// Shut down cleanly
runtime.shutdown();
```

## Using withSonder()

`withSonder()` wraps any async agent function with automatic event emission — before execution, after execution, and on error.

```typescript
import { createRuntime, withSonder } from '@heybeaux/sonder-sdk';

const runtime = createRuntime({ adapters: [...] });

async function myDraftAgent(input: { topic: string }) {
  // your agent logic here
  return { draft: `Post about ${input.topic}` };
}

const tracedDraft = withSonder(myDraftAgent, {
  bus: runtime.bus,
  agentId: 'agent:draft',
  taskId: 'task:linkedin-post',
  onEvent: (event) => console.log(`[${event.id}] ${(event.payload as any).phase}`),
});

// Every call emits before + after events automatically
const result = await tracedDraft({ topic: 'Sonder launch' });
```

## Causal Chains

Link events across agents using `parentId`:

```typescript
const researchEvent = await runtime.bus.emit({
  agent_id: 'agent:research',
  task_id: 'task:pipeline',
  payload: { action: 'research' },
});

const draftEvent = await runtime.bus.emit({
  agent_id: 'agent:draft',
  task_id: 'task:pipeline',
  parent_id: researchEvent.id,   // causal link
  payload: { action: 'draft' },
});
```

Or with `withSonder`:

```typescript
const tracedDraft = withSonder(myDraftAgent, {
  bus: runtime.bus,
  agentId: 'agent:draft',
  taskId: 'task:pipeline',
  parentId: researchEvent.id,   // all events from this agent chain to research
});
```

## Registering Adapters You Have

You don't need all six adapters. Sonder degrades gracefully — unregistered faculties default to safe empty values and emission never blocks.

```typescript
// Just Lattice + Engram — Parliament, ACR, LeWM, AWM default to empty
const runtime = createRuntime({
  adapters: [
    new LatticeAdapter({ ... }),
    new EngramAdapter({ ... }),
  ],
});
```

## Next Steps

- [Adapters guide](./adapters.md) — how to wire each adapter to its package, and how to write your own
- [Audit log guide](./audit-log.md) — querying the audit trail for compliance use cases
