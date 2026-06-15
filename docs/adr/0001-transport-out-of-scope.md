# ADR 0001 — Transport is out of scope; cross-host coordination rides A2A at the adapter boundary

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** @beauxwalton

## Context

Sonder is an **in-process** cognitive runtime. Faculties plug in via the `SonderAdapter` interface (`contribute` / `observe` / `checkGate`) — plain async method calls, not network endpoints. Adapters use an injected-callback pattern (see `docs/adapters.md`) and own no I/O themselves; the host application performs any fetching and hands snapshots in. There are no network primitives (`fetch`, sockets, gRPC, HTTP servers) anywhere in `packages/core`, `packages/sdk`, or the shipped adapters. Lattice coordination is likewise in-process `EventEmitter` pub/sub over State Contracts.

The AI-agent protocol ecosystem (MCP for tool calling, A2A for task coordination, ACP/ANP for messaging and discovery) is consolidating at the **application-semantics** layer, all over HTTP. The **transport/session** layer (peer discovery, NAT traversal, direct P2P routing) is unsolved and ~18–24 months from convergence (libp2p, Pilot Protocol, QUIC NAT-traversal). See VentureBeat, "MCP solved tool calling. A2A solved coordination. What solves transport?" (2026-06-13).

The risk this ADR guards against: a future contributor (human or Factory worker) inventing a bespoke Sonder-RPC or transport the first time someone needs two runtimes on different machines to coordinate.

## Decision

1. **Transport is explicitly out of scope for Sonder and Lattice.** We do not build, own, or wrap a wire protocol. Sonder remains an in-process substrate library that agents embed.
2. **We do not bolt A2A/MCP onto the in-process bus.** Wrapping local method calls in a network protocol would be cargo-culting. In-process stays in-process.
3. **The remote boundary, when it arrives, is `SonderAdapter` + Lattice State Contracts.** A remote faculty becomes "an adapter whose `contribute()` performs an A2A call." The State Contract already maps onto an A2A Agent Card / task envelope, so going cross-host is *serializing an existing type*, not a redesign.
4. **When we go cross-process/cross-host, we adopt the converged standards** (A2A for task coordination, MCP for tool calls) rather than rolling our own. We consume whatever wins the transport/session layer (libp2p, Pilot, QUIC) once it stabilizes.

## Consequences

- **Now:** no code changes. The architecture is already correctly separated — value lives in cognition + governance semantics, not plumbing.
- **The separation is currently vertical** (Sonder = substrate, host = I/O) rather than horizontal (agent-to-agent over a wire). That is intentional and sufficient for the in-process use case.
- **Future remote work is cheap to add and hard to get wrong**, because the boundary is pre-drawn at the adapter interface. No retrofit of observability/transport into a monolith — the lesson the microservices era taught.
- **Guardrail:** reject PRs that introduce a bespoke transport or RPC inside Sonder/Lattice. Route remote-coordination needs through an adapter that speaks A2A/MCP.
