# The heybeaux cognitive stack

Where Sonder sits, and how the pieces fit together. This is the canonical map.

## One sentence

**Sonder is the nervous system. The six faculties are the senses and organs. Ginnung is the dashboard you read it through. AOP is the language everything is recorded in.**

## The layers

```
APPLICATIONS      Inos (thinking surface), future apps      ← what users actually use
                                                              consume the faculties below
─────────────────────────────────────────────────────────
CONTROL PLANE     Ginnung (ginnung.ai)                      ← cockpit + faculty registry
                  renders cognition, installs faculties,       + gate-resolution UI
                  gate-resolution UI                           (in v1, also the runtime host)
─────────────────────────────────────────────────────────
RUNTIME           Sonder                                    ← the spine
(the spine)       signed event bus; every agent action         binds the six faculties
                  emits a SonderEventV2; emit pipeline is       into one audit chain
                  redact → enforce → validate-L0 → hash
                  → sign → persist

    SIX FACULTIES (each plugs in via SonderAdapter):
      ACR         capability   "what I can do"
      Engram      memory       "what I knew"
      Parliament  reasoning    "how I decided"
      Lattice     governance   "what I'm allowed to do"
      LeWM        prediction   "what I expect to happen"
      AWM         intent       "what I plan to do"
─────────────────────────────────────────────────────────
THE CONTRACT      AOP (Agent Observation Protocol)           ← language-neutral event schema
                  the event format Sonder emits;                Sonder is the reference impl;
                  see aop/schema/v0.1/                          other runtimes can emit it too
```

## The four distinctions that keep getting confused

1. **Sonder ≠ Ginnung.** Sonder is the *runtime* (the signed event bus). Ginnung is the *control plane* (the cockpit you watch it through). Locked 2026-05-13 — never conflate in PRs, docs, or commits. Ginnung also exists because `sonder.ai/.dev/.com` were unavailable, so `ginnung.ai` is the umbrella domain (`sonder.ginnung.ai`, `engram.ginnung.ai`, …).

   *v1 caveat (honest framing):* in v1, Ginnung's Next.js process also **is** the runtime host — it embeds Sonder in-process and faculties register as adapters. The clean "cockpit vs. separate runtime" split is the v1.5+ story (`@sonder/server`), not today's deployment.

2. **Sonder is not "becoming" AOP.** Sonder is the runtime; **AOP is the event format Sonder emits.** AOP is the part of Sonder's event schema lifted into a standalone, language-neutral spec so a non-Sonder runtime could emit the same shape. Sonder stays Sonder, and is the *reference implementation* of AOP.

3. **Engram is the memory faculty — one of six. It is not "the cognitive layer."** *Sonder* is the cognitive runtime. Engram answers "what I knew," nothing more.

4. **AWM is intent, not prediction. LeWM is prediction.** Two different faculties. AWM's validation domain happens to be a predictive trading pipeline, which is why it gets mislabeled — but its faculty slot is *intent* ("what I plan to do"). The prediction slot is **LeWM**, which currently exists only as a field in Sonder's event type union; the standalone faculty isn't built yet.

## The faculties as repos

| Faculty | Repo | Slot | Question |
|---|---|---|---|
| ACR | heybeaux/acr | capability | What can I do? |
| Engram | heybeaux/engram | memory | What did I know? |
| Parliament | heybeaux/parliament | reasoning | How did I decide? |
| Lattice | heybeaux/lattice | governance | What was I allowed to do? |
| LeWM | *(not yet stood up)* | prediction | What did I expect to happen? |
| AWM | heybeaux/awm | intent | What did I plan to do? |

Faculties depend on Sonder, not the other way around. Sonder is the substrate; it makes no policy decisions, recalls no memory, runs no deliberation — it carries the signed envelope and the audit chain.
