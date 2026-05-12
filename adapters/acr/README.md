# @heybeaux/sonder-adapter-acr

Sonder adapter for **ACR** (Adaptive Capability Resolution). Fills `event.capabilities` on every `SonderEvent`.

## Install

```bash
npm install @heybeaux/sonder-adapter-acr @heybeaux/sonder-core
```

## What it fills

```typescript
event.capabilities = {
  mounted:      string[];                        // capability IDs currently active
  resolution:   Record<string, LODLevel>;        // LOD per capability
  budget_used:  number;                          // tokens consumed by capability instructions
  budget_limit: number;                          // total token budget
}

type LODLevel = 'index' | 'summary' | 'standard' | 'deep';
```

## Usage

```typescript
import { AcrAdapter } from '@heybeaux/sonder-adapter-acr';
import { createRuntime } from '@heybeaux/sonder-sdk';

let currentCapabilities = {
  mounted:     ['web-search', 'memory-read'],
  resolution:  { 'web-search': 'standard', 'memory-read': 'deep' } as const,
  budget_used:  2100,
  budget_limit: 8000,
};

const runtime = createRuntime({
  adapters: [
    new AcrAdapter({
      getCapabilities: () => currentCapabilities,
    }),
  ],
});
```

## Config

```typescript
interface ACRAdapterConfig {
  // Return the current ACR state before each event.
  // Return null if ACR is not active — event.capabilities will be zeroed.
  getCapabilities(): ACRCapabilitySnapshot | null;
}

interface ACRCapabilitySnapshot {
  mounted:     string[];
  resolution:  Record<string, LODLevel>;
  budget_used:  number;
  budget_limit: number;
}
```

## Compliance

`event.capabilities.mounted` answers the regulated question **"What was the agent authorized to do?"** required by FINRA 2026 and MiFID II RTS 6.

## License

MIT
