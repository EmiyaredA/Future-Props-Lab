# Agent Note: Model runtime session ownership

Status: implemented

## Problem

Model runners, streaming settlement and restart recovery use the monolith's global session factory. Changing only HTTP dependencies leaves background writes directed at the old database, including cancellation paths after the original request session closes.

## Decision

Require explicit session factories for model execution, recovery and short settlement transactions. HTTP/WebSocket entry points pass their own ASGI database factory; the recovery website installs its original factory explicitly. Independent Models can supply its guarded sessions without sharing an active AsyncSession. Each settlement binds the persisted/request owner before writing its own call log.

## Alternatives considered

- Replacing the global factory at startup couples applications through shared mutable state.
- Keeping a request session alive through network streams creates long transactions and cancellation races.
- Falling back to the original factory hides missing independent service bindings.

## Verification

All 136 targeted model generation, inference, transcription, stream recovery, native-model adapter and realtime regressions pass. Two guarded databases demonstrate parallel call-log isolation and closing-stream failure settlement with explicit account binding. The full backend suite passes 2000 tests with four conditional skips. A subsequent recovery refinement passes five focused checks: recovery reads affected accounts without writing globally, commits per account, resumes after a simulated restart between accounts, preserves partial content and increments each affected conversation once. Contract/SDK checks and Python lint/format pass; no supplier submission policy or public schema changes.

## Consequences

Factory ownership is an assembly decision rather than an imported global. Recovery's system session is read-only; every write transaction has a single explicit account. Account-by-account recovery can make partial progress safely and resumes idempotently on the next startup. The architecture gate prevents direct monolith factory imports in execution modules, while the named recovery-website credential adapter remains isolated as legacy code.

## Risks

Explicit sessions do not complete the remaining asset, quota, native MLX, demo configuration or task-record ports. The unassembled Models service remains gated; these changes do not start it against formal data.
