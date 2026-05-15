export type {
  SonderEvent,
  SonderEventAny,
  SonderEventV1,
  SonderEventV2,
  SonderEventCore,
  EventFilter,
  LODLevel,
  ApprovalGate,
  CapabilityContext,
  MemoryContext,
  ReasoningContext,
  GovernanceContext,
  PredictionContext,
  IntentContext,
  PolicyEvidenceRow,
  RedactionEvidence,
} from './types/event.js';

export type { SonderAdapter } from './types/adapter.js';

export { GatePendingError, findPendingGate } from './gate.js';

export { SonderBus } from './bus.js';
export type { SonderBusOptions } from './bus.js';

export { AuditLog } from './audit.js';
export type { AuditLogReadFilter, GenesisRow } from './audit.js';

export {
  canonicalize,
  chainSelfHash,
  hashEvent,
  sha256Hex,
  stripChainFields,
  stripSignatureField,
} from './hash.js';

export {
  loadOrGenerateKeypair,
  loadKeypair,
  generateAndPersistKeypair,
  sign,
  verify,
  publicKeyFromRawBase64,
  privateKeyFromRawBase64,
  validateL0EvidenceOrThrow,
  SignRefusedError,
} from './sign.js';
export type { KeypairFile, LoadedKeypair } from './sign.js';

export {
  genesisSeed,
  readPrevHashForNextEvent,
  stampChainHashes,
} from './chain.js';

export {
  redactJson,
  redactSonderEvent,
  RedactionRefusedError,
  DEFAULT_MUST_NOT_REDACT,
  conditionalGovernanceFields,
  validateMustNotRedactOverride,
} from './redact.js';
export type {
  SensitivityLevel,
  RedactJsonOptions,
  RedactJsonResult,
  RedactSonderEventOptions,
  RedactSonderEventResult,
  RedactionEvidenceBlock,
} from './redact.js';

export { createEventId } from './ulid.js';
