# Agent Note: Visual workflow component boundaries

Status: implemented

## Problem

Visual's board and canvas mutate persistence refs independently, leaving an old save failure active after loading a server snapshot. Creative DTOs, decisions and SQLite transactions share a module; generation discovers dependencies through application state. Provider-specific reference decisions are duplicated between independent and website execution. The polling runtime also shares a semaphore across unrelated application instances and event loops.

## Decision

- Persistence owns conflict resolution, pending-save draining, metadata replacement, error reset and immediate-save commands. Views read detached snapshots and invoke commands. Board consumers use a narrowed controller contract; task polling and viewport gesture lifecycles have dedicated hooks.
- Creative schemas contain only values. `CreativeWorkflow` and creative rules consume typed asset and storage ports; SQL adapters own owner-scoped reads, CAS and short atomic writes. Card-generation bindings stage the card revision and operation receipt inside the task-creation transaction and never commit independently.
- Generation intake receives preparation, storage and reference-delivery ports explicitly. The HTTP boundary binds request identity and concrete adapters. Network preparation runs between the durable preparing decision and the short commit transaction. Abort changes only still-preparing decisions, preserving uncertain activation outcomes.
- Models owns provider reference policy. Selection metadata adds typed reference capabilities; the immutable `VisualModelChoice` embedded in a generation plan retains its existing shape and digest. Website and independent execution consume the same policy.
- Asset selection queries live in the Assets data adapter. Project error mapping is independent of individual routers, and Visual path creation is independent of page registration.
- Polling limits belong to runner instances by default, with optional explicit shared-limit injection. Failed and cancelled polls cancel and await sibling cleanup before returning. Models admission remains responsible for model execution capacity.
- Account-owned Visual cards participate in website tenant filtering. Isolated account cleanup includes these roots before deleting projects referenced by their media.
- The registered creative-workflow migration's SQL remains byte-for-byte intact. Its long SQL line uses the existing per-file Ruff exemption mechanism instead of editing registered migration text.

## Alternatives considered

- Resetting one board error ref fixes the symptom but retains two diverging recovery implementations.
- Passing a smaller state wrapper still hides dependency discovery and concrete peer creation inside the use case.
- Adding capabilities to the frozen plan model changes existing digests and is unnecessary for reference planning; keeping them in selection metadata avoids that change.
- Renaming or mechanically splitting large files leaves lifecycle and transaction ownership ambiguous. Splits follow decisions, persistence, task observation and viewport interaction instead.

## Consequences

Public routes, payload schemas, registered migrations and database tables remain stable. Internal model-selection consumers require matching service code. Schemas and workflow rules can be loaded and tested without SQL or HTTP adapters. Views cannot reset persistence internals, and replacing an external asset or generation component does not require supplying application state.

The default polling limit is four tasks per runner instance; sharing a process-wide budget now requires explicit assembly ownership rather than an import-time singleton. Architecture gates enforce the pure workflow modules, view boundary and existing dependency directions. Product documentation remains untouched.

## Verification

Deterministic tests cover board recovery after a failed save, server/local conflict resolution, queued-save draining, replaceable in-memory workflow ports, generation preparation failure, exact card-generation replay, independent protocol grants, polling isolation across event loops and sibling cleanup on failure/cancellation. Repository architecture, frontend type checking, relevant workflow suites, formatting, contract consistency and build checks provide the delivery evidence.

The architecture/runtime/Visual backend run passes 438 tests with one existing skip; the creative suite including the additional bound-account bulk-query/write test passes all five tests. The focused frontend run passes 51 tests. Expanded Visual/canvas testing passes 252 tests and reproduces three failures unchanged in an isolated HEAD checkout (missing jsdom dialog support and two obsolete UI expectations). Lint, formatting, TypeScript, service contracts, public OpenAPI/SDK generation checks and the Studio build pass. The aggregate contract check still reports stale protected SDK documentation, which is not regenerated here. The socket-based historical migration journey is excluded because the sandbox cannot bind a loopback port.
