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

## Implementation progress

Identity now has its own ASGI assembly, registered schema, SQLite lock, account creation outbox and minimal dependency-locked image. Public account operations reuse existing governance rules through explicit initialization callbacks; the legacy monolith retains catalog seeding. The gateway routes by the operation manifest, removes forged identity headers and asks Identity for request-bound assertions. Service authentication and live authorization primitives do not query another service's database.

Real isolated Compose checks exercise account login without Portal, independent restarts, duplicate-writer rejection, WAL, offline snapshot restore and logout. A disposable protocol probe checks header forwarding and listener authority; it is not an Agents implementation. All other business services, independent browser entries, native workers, event consumers and formal data import remain required before production cutover.


Agents now has an owned schema, source subscription coordinator, native job queue and independent image. The image contains neither Identity ORM nor native parsers. A separate Mac collector initiates authenticated loopback RPC, preserves one pending projection frame per source task and resumes from server checkpoints; frame acknowledgement and projection commit atomically. Read-only subscriptions are fenced by source revision, current subscription and live account permission. Generic unknown execution outcomes are never reassigned. Browser credentials are stripped before business proxying.

Real container acceptance now covers native fixture indexing, independent Agents replacement, continued incremental follow, fresh login with no Portal process, listener separation and owned SQLite integrity. Fresh-process tests cover lost acknowledgements, collector restart, duplicate frames, cross-account denial, attachment references and revoked streams. Independent browser bundles, remaining services, canonical deployment projections, production import and final cutover remain outstanding.
