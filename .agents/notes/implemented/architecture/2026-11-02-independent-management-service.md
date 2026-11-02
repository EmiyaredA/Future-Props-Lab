# Agent Note: Independent management service

Status: implemented

## Problem

The embedded management shell and public-access controls disappear when business processes fail. Moving only the UI leaves host operations, authentication and database ownership coupled to the business application. The initial shared-SQLite draft also conflicts with the user's subsequent decision to give every service its own database.

## Decision

Management is an independent release and database in the approved multi-service architecture. Identity owns account/session purpose and the separate management cookies. Models owns model templates, quotas and demo-runtime governance. Management receives request-bound Identity assertions and owns only native command receipts and sanitized host observations.

The management Caddy ingress has independent origins, credentials and listeners. Its public lane allows platform governance while signed local-browser assertions gate host control. The business gateway does not publish management or platform-governance routes. Native operations use a separate authenticated loopback lane and an outbound Mac worker. Docker Compose and SSH execution never enter the container.

The Mac worker accepts fixed operations, persists execution intent before acting, and returns immutable receipts. Expired or ambiguous execution is never automatically repeated. Graceful shutdown and explicit force-stop are separate operations. Identity is rechecked before a queued task can execute. An independent observation loop cleans up the remaining business group on a partial crash or failed startup, preserving the failure state while Management stays available. The existing singleton monolith remains a migration-time recovery entry and does not register the Identity-only migration.

## Alternatives considered

- A second frontend using the old business backend would remain unavailable when business processes stop.
- Two processes sharing the old SQLite were drafted, then superseded by the user's confirmed per-service database decision. That draft is preserved outside tracked sources in the original chat workspace; it is not the implementation.
- Giving a management container the Docker socket or personal SSH/CLI files would bypass the approved native capability boundary.

## Consequences

Governance requires its owning service to be available: Identity and Models stay outside the stoppable business group. This branch defines management-side integration and requires the independently developed Models deployment at final integration. It must not fall back to the legacy database or use another service's ORM.

Formal data export/import and the final deployment switch remain the responsibility of the multi-service rollout. This implementation does not migrate, stop or reconfigure the live deployment. No real configuration, credentials or production snapshots are committed.

## Verification

Fresh-process tests exercise real Identity login, session audience separation, ordinary-user rejection, public-host-operation denial, authorization revocation, idempotent requests and native receipt settlement using separate temporary databases. Host tests use fake Compose/SSH/network dependencies, including explicit force-stop and independent tunnel shutdown. The standalone browser journey covers light/dark modes at 390/768/1600 widths and keyboard focus. Container acceptance uses disposable data and simulated business execution only.

Final isolated acceptance: backend 1905 passed / 4 skipped; Web 281 files / 1802 tests passed; management browser 7 passed and retained business browser 5 passed. Full build, standalone Management build, TypeScript, lint, format, contract stale-checks, Agent Note checks and protected-doc checks passed. Final Identity/Management Docker images passed the disposable-container acceptance, including account governance after the simulated business service stopped, public host-control denial and receipt recovery after Management restart. Real Models integration, production data migration and the formal deployment switch are not claimed by these tests.
