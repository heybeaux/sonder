# @heybeaux/sonder-adapter-engram

Sonder adapter for **Engram** (memory retrieval). Fills `event.memory` on every `SonderEvent`.

## Install

```bash
npm install @heybeaux/sonder-adapter-engram @heybeaux/sonder-core
```

## What it fills

```typescript
event.memory = {
  refs:        string[];   // memory record IDs consulted
  query?:      string;     // semantic query used for retrieval
  confidence:  number;     // 0–1 ensemble retrieval confidence
  dream_cycle?: string;    // consolidation cycle ID if post-dream
}
```

## Usage

```typescript
import { EngramAdapter } from '@heybeaux/sonder-adapter-engram';
import { createRuntime } from '@heybeaux/sonder-sdk';

let lastRetrieval = null;

const runtime = createRuntime({
  adapters: [
    new EngramAdapter({
      getLastRetrieval: () => lastRetrieval,
    }),
  ],
});

// Before an agent step, set the retrieval result:
lastRetrieval = {
  refs:       ['mem:voice-001', 'mem:guidelines-003'],
  query:      'writing style and tone preferences',
  confidence: 0.91,
};

await tracedAgent({ topic: 'AI governance' });
```

## Config

```typescript
interface EngramAdapterConfig {
  // Return the last retrieval result before each event.
  // Return null if no retrieval occurred — event.memory will be zeroed.
  getLastRetrieval(): EngramRetrievalSnapshot | null;
}

interface EngramRetrievalSnapshot {
  refs:         string[];
  query?:       string;
  confidence:   number;
  dream_cycle?: string;
}
```

## Compliance

`event.memory.refs` answers the regulated question **"What did the agent know?"** required by HIPAA and EU AI Act Art. 12.

## License

MIT
