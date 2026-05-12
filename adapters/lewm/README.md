# @heybeaux/sonder-adapter-lewm

Sonder adapter for **LeWM** (Learned World Model). Fills `event.prediction` on every `SonderEvent` and closes the governance feedback loop by updating Beta distribution beliefs.

## Install

```bash
npm install @heybeaux/sonder-adapter-lewm @heybeaux/sonder-core
```

## What it fills

```typescript
event.prediction = {
  outcome:    string;  // predicted outcome label
  confidence: number;  // 0–1 Bayesian Beta distribution mean
  alpha:      number;  // Beta α (successes observed)
  beta:       number;  // Beta β (failures observed)
  model_id:   string;  // LeWM model that produced this prediction
}
```

## Usage

```typescript
import { LewmAdapter } from '@heybeaux/sonder-adapter-lewm';
import { createRuntime } from '@heybeaux/sonder-sdk';

let alpha = 1;
let beta  = 1;

let currentPrediction = null;

const runtime = createRuntime({
  adapters: [
    new LewmAdapter({
      getCurrentPrediction: () => currentPrediction,

      // Called after every event that has a governance contract_id.
      // Update your Beta distribution here.
      onGovernanceOutcome: (outcome, violations) => {
        if (outcome === 'pass') alpha++;
        else beta++;
        console.log(`LeWM updated: α=${alpha} β=${beta} mean=${(alpha / (alpha + beta)).toFixed(3)}`);
      },
    }),
  ],
});

// Set prediction before each step:
currentPrediction = {
  outcome:    'handoff_success',
  confidence: alpha / (alpha + beta),
  alpha,
  beta,
  model_id:   'lewm-v1',
};
```

## Config

```typescript
interface LeWMAdapterConfig {
  // Return the current prediction. Return null if none — event.prediction will be zeroed.
  getCurrentPrediction(): LeWMPredictionSnapshot | null;

  // Optional. Called after events with a non-empty governance.contract_id.
  // Use this to update LeWM's Beta distribution (α++ on pass, β++ on fail).
  onGovernanceOutcome?(
    outcome:    'pass' | 'fail',
    violations: string[],
    event:      SonderEvent,
  ): void;
}
```

## LeWM ↔ AWM feedback loop

LeWM is the **hypothesis generator** — it produces structured predictions from learned world model representations. When it observes governance outcomes via `onGovernanceOutcome()`, it updates its internal beliefs: alpha increments on pass, beta increments on fail.

AWM is the **calibration layer** — it scores LeWM's predictions against actual step outcomes. Over time, AWM's calibration tells you how much weight to place on LeWM's structural predictions.

Both callbacks are optional — the observe loop only activates when you supply them.

## Compliance

`event.prediction.*` answers the regulated question **"What did the agent predict?"** required by SEC AI oversight guidance and the CFTC Oct 2024 Advisory.

## License

MIT
