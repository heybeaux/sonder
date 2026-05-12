# @heybeaux/sonder-sdk

The ergonomic entry point to the Sonder cognitive runtime. Two exports: `createRuntime()` and `withSonder()`.

## Install

```bash
npm install @heybeaux/sonder-sdk @heybeaux/sonder-core
```

Add whichever adapter packages you need:

```bash
npm install @heybeaux/sonder-adapter-engram @heybeaux/sonder-adapter-lattice
```

## Quick start — 5 minutes

```typescript
import { createRuntime, withSonder } from '@heybeaux/sonder-sdk';
import { EngramAdapter } from '@heybeaux/sonder-adapter-engram';
import { LatticeAdapter } from '@heybeaux/sonder-adapter-lattice';

// 1. Create a runtime with the adapters you want
const runtime = createRuntime({
  adapters: [
    new EngramAdapter({ getLastRetrieval: () => null }),
    new LatticeAdapter({ getContract: () => null }),
  ],
});

// 2. Wrap your agent function
async function myAgent(input: { query: string }) {
  return { answer: `Response to: ${input.query}` };
}

const traced = withSonder(myAgent, {
  bus:     runtime.bus,
  agentId: 'agent:my-agent',
  taskId:  'task:run-001',
});

// 3. Call it — before/after events are emitted automatically
const result = await traced({ query: 'Hello' });

// 4. Query the audit log
const events = runtime.bus.query({ task_id: 'task:run-001' });
console.log(`${events.length} events recorded`);

runtime.shutdown();
```

## `createRuntime(config)`

Registers adapters on a configured `SonderBus` and returns a `{ bus, shutdown }` object.

```typescript
interface RuntimeConfig {
  adapters?: SonderAdapter[];
  dbPath?: string;   // path to SQLite audit log — omit for in-memory
}

interface SonderRuntime {
  bus: SonderBus;
  shutdown(): void;
}
```

The bus is a `SonderBus` from `@heybeaux/sonder-core` — you can call `bus.emit()`, `bus.on()`, `bus.onAny()`, and `bus.query()` directly.

## `withSonder(fn, options)`

Higher-order function that wraps any async agent function with automatic before/after event emission.

```typescript
interface WithSonderOptions {
  bus:      SonderBus;
  agentId:  string;
  taskId:   string;
  parentId?: string;
}

// Wraps fn — calls bus.emit() before and after each invocation
function withSonder<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options: WithSonderOptions,
): (input: TInput) => Promise<TOutput>;
```

Each call to the wrapped function emits two events:
- **before** — `payload: { phase: 'before', input }`
- **after** — `payload: { phase: 'after', input, output }`

Both events carry the same `agent_id`, `task_id`, and all adapter contributions at time of execution.

## Multi-agent pipeline example

```typescript
import { createRuntime, withSonder } from '@heybeaux/sonder-sdk';
import { EngramAdapter } from '@heybeaux/sonder-adapter-engram';
import { LatticeAdapter } from '@heybeaux/sonder-adapter-lattice';
import { ParliamentAdapter } from '@heybeaux/sonder-adapter-parliament';

let currentRetrieval = null;
let currentContract  = null;
let currentDeliberation = null;

const runtime = createRuntime({
  adapters: [
    new EngramAdapter({ getLastRetrieval: () => currentRetrieval }),
    new LatticeAdapter({ getContract: () => currentContract }),
    new ParliamentAdapter({ getLastDeliberation: () => currentDeliberation }),
  ],
});

const TASK = 'task:pipeline-001';

const researchAgent = withSonder(
  async ({ topic }: { topic: string }) => ({ findings: `Research on: ${topic}` }),
  { bus: runtime.bus, agentId: 'agent:research', taskId: TASK },
);

const draftAgent = withSonder(
  async ({ findings }: { findings: string }) => ({ draft: findings.slice(0, 80) }),
  { bus: runtime.bus, agentId: 'agent:draft', taskId: TASK },
);

// Swap adapter state before each step to reflect live cognitive context
currentRetrieval = { refs: ['mem:001'], confidence: 0.91 };
const { findings } = await researchAgent({ topic: 'AI governance' });

currentRetrieval = { refs: ['mem:002'], confidence: 0.84 };
await draftAgent({ findings });

const stepEvents = runtime.bus.query({ task_id: TASK });
console.log(`${stepEvents.length} events — ${stepEvents.length / 2} steps`);

runtime.shutdown();
```

## Packages

| Package | Description |
|---|---|
| `@heybeaux/sonder-core` | Event bus, envelope schema, audit log |
| `@heybeaux/sonder-sdk` | `createRuntime()` + `withSonder()` HOC (this package) |
| `@heybeaux/sonder-adapter-acr` | ACR capability context adapter |
| `@heybeaux/sonder-adapter-engram` | Engram memory context adapter |
| `@heybeaux/sonder-adapter-parliament` | Parliament reasoning context adapter |
| `@heybeaux/sonder-adapter-lattice` | Lattice governance context adapter |
| `@heybeaux/sonder-adapter-lewm` | LeWM prediction context adapter |
| `@heybeaux/sonder-adapter-awm` | AWM intent context adapter |

## License

MIT
