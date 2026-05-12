# @heybeaux/sonder-adapter-awm

Sonder adapter for **AWM** (Agent Workflow Memory). Fills `event.intent` on every `SonderEvent` and scores LeWM predictions against actual step outcomes for calibration.

## Install

```bash
npm install @heybeaux/sonder-adapter-awm @heybeaux/sonder-core
```

## What it fills

```typescript
event.intent = {
  action:               string;   // the action/step type being taken
  step_trace_id:        string;   // AWM StepTrace reference
  skipped:              boolean;  // true if AWM recommended skipping (high confidence)
  skip_reason?:         string;   // reason for skip
  constraint_injected:  boolean;  // true if approval gate pre-injected constraints
}
```

## Usage

```typescript
import { AwmAdapter } from '@heybeaux/sonder-adapter-awm';
import { createRuntime } from '@heybeaux/sonder-sdk';

let currentIntent = null;

const runtime = createRuntime({
  adapters: [
    new AwmAdapter({
      getCurrentIntent: () => currentIntent,

      // Called after events that have both a step_trace_id and a governance contract_id.
      // Use this to record step outcomes and calibrate LeWM predictions.
      onStepOutcome: (traceId, outcome, event) => {
        console.log(`AWM scored trace ${traceId}: ${outcome}`);
        // Record in your frequency model here
      },
    }),
  ],
});

// Set intent before each step:
currentIntent = {
  action:              'draft_post',
  step_trace_id:       'trace:draft-001',
  skipped:             false,
  constraint_injected: true,
};
```

## Config

```typescript
interface AWMAdapterConfig {
  // Return the current intent snapshot. Return null if none — event.intent will be zeroed.
  getCurrentIntent(): AWMIntentSnapshot | null;

  // Optional. Called after events with both a step_trace_id and governance.contract_id.
  // Use this to score LeWM predictions against actual outcomes.
  onStepOutcome?(
    stepTraceId: string,
    outcome:     'pass' | 'revise' | 'fail',
    event:       SonderEvent,
  ): void;
}

interface AWMIntentSnapshot {
  action:               string;
  step_trace_id:        string;
  skipped:              boolean;
  skip_reason?:         string;
  constraint_injected:  boolean;
}
```

## AWM ↔ LeWM feedback loop

AWM is the **calibration layer** — it tracks historical step frequencies and scores LeWM's predictions against actual outcomes. When `onStepOutcome()` fires, record the result in your frequency model to update how much weight to place on LeWM's structural predictions.

LeWM is the **hypothesis generator** — it maintains Beta distribution beliefs that AWM's calibration informs over time.

Both callbacks are optional — the observe loop only activates when you supply them.

## Compliance

`event.intent.*` surfaces what the agent intended to do, whether it was skipped for efficiency, and whether approval constraints were pre-injected — supporting auditability requirements under EU AI Act Art. 12.

## License

MIT
