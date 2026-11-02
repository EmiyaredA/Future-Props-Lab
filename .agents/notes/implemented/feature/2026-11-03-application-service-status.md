# Agent Note: Application service availability

Status: implemented

## Problem

The application catalogue offers navigation without indicating whether an application's service is ready, stopped or failing. A connection error alone cannot distinguish a stopped process from an offline host or unavailable monitoring.

## Decision

Render per-service status and expandable explanations on application cards, using explicit application-to-service IDs. Gateway readiness probes combine with fresh sanitized lifecycle observations from the outbound Mac management worker. Only confirmed lifecycle observations report stopped, paused or undeployed; missing/expired monitoring cannot imply those states. A healthy application with unavailable dependencies is degraded.

A narrowly delegated original browser request reads only Management's global service observations. It cannot read logs, host paths, account records or execute commands. Polling and explicit refresh are read only; the existing CLI/SDK business whitelist stays unchanged. A failed refresh marks cached results as historical. Legacy monolith status explicitly identifies its shared process.

## Alternatives considered

- Marking every failed probe as stopped confuses host/network failures with lifecycle state.
- Querying Docker or business databases from Portal breaks the approved service boundary.
- Leaving the last healthy result unqualified after disconnect misrepresents current availability.

## Consequences

The Mac worker reports bounded lifecycle observations independently of Portal. Gateway caches readiness briefly, but newer stop evidence supersedes cached successes. Positive readiness supersedes older lifecycle evidence. Transitive dependency issues do not imply that the application's own process stopped. Network failures cannot prove process exit. Normal SIGTERM exits retain the stopped explanation; ambiguous SIGKILL exits include possible force/resource causes.

## Verification

Backend tests cover signed browser access, bounded delegation, revoked sessions, malformed probes, stale observations, dependency propagation, cached success versus newer stops, and lifecycle explanations. Component tests cover expansion, refresh and cached failure. The seven-container synthetic acceptance checks real Mac Docker observations through Management and Identity delegation, Portal stop/recovery without sibling restarts, browser keyboard expansion and mobile/tablet/desktop layouts in both themes. CI executes the same container path. No formal data is changed.
