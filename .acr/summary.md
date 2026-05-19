# Sonder

The runtime that every heybeaux agent action passes through. A signed event bus where each `SonderEventV2` carries structured cognitive context from six faculties (capabilities/ACR, memory/Engram, reasoning/Parliament, governance/Lattice, prediction/LeWM, intent/AWM) — producing a queryable, cryptographically chained audit trail. Faculties plug in via the `SonderAdapter` interface.

**Provides:** agent-runtime, event-bus, audit-trail
**Repo:** https://github.com/heybeaux/sonder
**Relates to:** Ginnung observes Sonder's event stream (control plane), six faculties speak Sonder

Sonder is the **runtime product** — distinct from Ginnung, which is the user-facing control plane that runs over it. v1 is tightly coupled to Ginnung by design.
