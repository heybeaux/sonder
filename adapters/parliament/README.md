# @heybeaux/sonder-adapter-parliament

Sonder adapter for **Parliament** (multi-neurotype deliberation). Fills `event.reasoning` on every `SonderEvent`.

## Install

```bash
npm install @heybeaux/sonder-adapter-parliament @heybeaux/sonder-core
```

## What it fills

```typescript
event.reasoning = {
  model:      string;    // primary model used
  neurotypes: string[];  // active neurotype IDs in deliberation
  consensus:  boolean;   // true if all neurotypes agreed
  dissent:    string[];  // neurotype IDs that dissented
  osi:        number;    // Opinion Shift Index (0–1, echo-chamber detection)
  rounds:     number;    // deliberation rounds taken
}
```

## Usage

```typescript
import { ParliamentAdapter } from '@heybeaux/sonder-adapter-parliament';
import { createRuntime } from '@heybeaux/sonder-sdk';

let lastDeliberation = null;

const runtime = createRuntime({
  adapters: [
    new ParliamentAdapter({
      getLastDeliberation: () => lastDeliberation,
    }),
  ],
});

// After Parliament deliberates, set the result:
lastDeliberation = {
  model:      'claude-opus-4-7',
  neurotypes: ['empiricist', 'skeptic', 'synthesizer'],
  consensus:  true,
  dissent:    [],
  osi:        0.38,
  rounds:     2,
};
```

## Config

```typescript
interface ParliamentAdapterConfig {
  // Return the last deliberation result before each event.
  // Return null if no deliberation occurred — event.reasoning will be zeroed.
  getLastDeliberation(): ParliamentDeliberationSnapshot | null;
}

interface ParliamentDeliberationSnapshot {
  model:      string;
  neurotypes: string[];
  consensus:  boolean;
  dissent:    string[];
  osi:        number;
  rounds:     number;
}
```

**Opinion Shift Index (OSI):** measures how much neurotype opinions shifted during deliberation. Low OSI (<0.2) suggests echo-chamber dynamics. High OSI (>0.7) suggests genuine disagreement that reached resolution.

## Compliance

`event.reasoning.*` answers the regulated question **"What did the agent decide and why?"** required by ESMA Feb 2026 and FCA Consumer Duty.

## License

MIT
