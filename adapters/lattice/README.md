# @heybeaux/sonder-adapter-lattice

Sonder adapter for **Lattice** (governance and validation). Fills `event.governance` on every `SonderEvent`.

## Install

```bash
npm install @heybeaux/sonder-adapter-lattice @heybeaux/sonder-core
```

## What it fills

```typescript
event.governance = {
  contract_id:    string;   // Lattice StateContract that governed this event
  validated:      boolean;  // true if all validation layers passed
  l1_pass:        boolean;  // structural (JSON schema) validation
  l2_pass:        boolean;  // semantic (embedding similarity) validation
  l3_pass:        boolean;  // LLM-as-judge hallucination detection
  violations:     string[]; // validation failure codes
  circuit_state:  'closed' | 'open' | 'half-open';
}
```

## Usage

```typescript
import { LatticeAdapter } from '@heybeaux/sonder-adapter-lattice';
import { createRuntime } from '@heybeaux/sonder-sdk';

let currentContract  = null;
let currentValidation = null;

const runtime = createRuntime({
  adapters: [
    new LatticeAdapter({
      getContract:       () => currentContract,
      getCircuitState:   () => 'closed',
      getLastValidation: () => currentValidation,
    }),
  ],
});

// Before a governed step:
currentContract  = { id: 'contract:handoff-v1', /* ... */ };
currentValidation = {
  validated: true,
  l1_pass:   true,
  l2_pass:   true,
  l3_pass:   true,
  violations: [],
};
```

## Config

```typescript
interface LatticeAdapterConfig {
  // Return the active StateContract. Return null if no contract — event.governance will be zeroed.
  getContract(): StateContract | null;

  // Return the current circuit breaker state. Defaults to 'closed' if omitted.
  getCircuitState?(): 'closed' | 'open' | 'half-open';

  // Return the last validation result. Defaults to all-false if omitted.
  getLastValidation?(): LatticeValidationSnapshot | null;
}

interface LatticeValidationSnapshot {
  validated:  boolean;
  l1_pass:    boolean;
  l2_pass:    boolean;
  l3_pass:    boolean;
  violations: string[];
}
```

## Validation layers

| Layer | What it checks |
|---|---|
| L1 | Structural — JSON schema conformance |
| L2 | Semantic — embedding similarity to expected output |
| L3 | LLM-as-judge — hallucination and factuality detection |

## Compliance

`event.governance.validated` and `event.governance.violations` answer the regulated question **"Was the handoff valid?"** required by EU AI Act Art. 12 and the NAIC Model Bulletin.

## License

MIT
