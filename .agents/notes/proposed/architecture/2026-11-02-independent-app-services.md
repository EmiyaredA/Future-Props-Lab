# Agent Note: Independently released applications with Compose and native Mac workers

Status: proposed

## Problem

The website owns all application routes, SQLite tables and task runners in one process. Updating the portal interrupts Agent indexing, browser login and every application. A second hostname or another copy of the complete backend retains those dependencies and risks conflicting data writers.

## Proposal

Keep one repository, a stable same-origin gateway and independent application releases. Each service owns its data, migrations, operations and runners. Identity owns existing accounts, sessions and API keys. Shared assets, models, rendering, integrations and native execution are explicit capabilities accessed through versioned interfaces.

Compose is the production entry point. Mac session collection, CLI/stdio/sandbox execution, MLX and host tools remain narrowly authorized native workers. They initiate authenticated connections to a loopback task ingress; containers do not receive personal home directories, native CLI credentials or the Docker socket. Portal updates do not restart Identity, Agents, Remote or the tunnel.

Current website runtime data is the sole authoritative source. Formal cutover is gated on exhaustive operation/table ownership, isolated migration and restore checks, complete service implementations and cross-application regressions. The running monolith remains unchanged until those gates pass. Existing SQLite migrations are not rewritten and persistent records are changed only through formal business use cases.

## Alternatives considered

- Sharing the monolith database between processes leaves migrations and ownership coupled.
- Loading the entire backend in every container multiplies workers and exposes unrelated schemas.
- Containerizing macOS-only code loses native sessions, system permissions and Metal models.
- Online migration needs a long-lived dual-write protocol; the approved rollout uses a maintenance window.

## Acceptance criteria

All applications and capabilities have separate releases and data. Stop Portal while Agents synchronizes, Remote stays connected and fresh login succeeds. Restart each application independently. Preserve contracts, ownership, CAS, media exports, approvals and supplier submission recovery. Verify persistence, native worker reconnect, backup/restore and quality gates before opening formal writes. Restore matching code, configuration and runtime together if cutover validation fails.

## Risks

Service boundaries can preserve hidden database joins, stale authorization or duplicate supplier submissions if only entry points are separated. New runtime primitives and ownership manifests are preparation, not production readiness. Keep production on the archived monolith until every service has isolated business, storage, migration and restore coverage, including revocation of active streams and native worker receipts. Never copy the complete legacy database into each service.
