# Agent Note: Website-only runtime and authoritative desktop data relocation

Status: implemented

## Problem

Electron owned startup, local file authorization, automation pairing and Amadeus window communication. Browser access depended on keeping the native application running. The repository also contained old development data and temporary creative outputs that must not replace or be confused with the live desktop installation.

## Decision

The browser is the only supported client. One locked Python website process serves the local origin and owns a separate public ingress with lifespan disabled. The actual bound socket determines local host-management authority. Public administrators cannot discover host directories, change Codex settings, manage disks or control the public tunnel. Cloud hosting contains only matching program resources; private API/media responses remain uncacheable.

Amadeus uses an account-scoped page provider and explicit context/reference callbacks. CLI/SDK/MCP use website URLs and Management API Keys; both ingresses enforce the same injected business allowlist, capability discovery retains that allowlist and navigation returns owned resource links. Bearer clients do not inherit browser CSRF requirements; browser Session requests retain Origin and CSRF checks. Electron transport, pairing, windows and packaging are removed after preserving the desktop baseline on `codex/desktop-archive-2026-11-02`.

The authoritative migration source is the user's active Application Support/Future Props Lab directory. Its runtime and local models move into the repository's ignored `.runtime/`, while its original TOML encryption key and gateway credentials are retained. Existing repository development data is preserved separately, never merged. Offline transfer only copies files and performs read-only SQLite checks; it does not execute migrations or edit persistent records. The service locks the retained original installation as well as the new runtime to prevent accidental divergent instances.

Temporary cleanup has an explicit manifest. It removes reproducible caches and byte-identical creative duplicates only after verifying a durable account asset and its association. Active tasks, references, unique originals, deliverables and recovery snapshots remain protected. The retirement task independently owns its separately authorized maintenance; website startup does not bypass that task's pending approval or locks.

## Alternatives considered

- Keeping Electron as an optional shell retains native startup, packaging and IPC maintenance.
- Moving all backend data and CLI execution to a cloud server loses the existing Mac identities and local capabilities.
- Reusing the repository's old development database loses the active accounts and projects.
- Deleting the complete ignored temporary tree would discard unique creative originals and recovery evidence.

## Consequences

The website requires the host's Python/Node/FFmpeg installation. Browser sessions replace desktop login and clients explicitly configure their API keys. Public availability still depends on the Mac and tunnel; closing a browser has no effect on backend task lifetime. Source data and verified snapshots remain available for coordinated rollback with matching code and configuration.

## Verification

Isolated transfer tests cover the authoritative source, preservation without merging, live locks, missing keys, copy failures and configuration publication rollback. Real Session tests cover local/public account sharing, spoofed ingress rejection, host administration denial, CSRF, removed native routes and SPA 404 behavior. Website, SDK, UI, architecture and deployment checks are recorded in `.local/website-transition/`. The final full run passes 1762 backend tests (3 credential/environment skips) and all 1792 Web tests; website browser regression covers phone, tablet and desktop in both themes. Contracts, lint, formatting, production build, LFS and documentation protection checks pass.

The approved offline transfer verifies 114816 files and 124507354990 bytes, with schema 0118, and preserves both the original desktop root and the complete recovery snapshot. The separate retirement task has completed its own approved maintenance before transfer. Cleanup removes 2248 reviewed caches/duplicates plus four obsolete desktop build/cache roots, releasing 10118780235 logical bytes and 10146910208 measured disk bytes. No formal library asset is deleted.

The sole LaunchAgent serves local port 9000 and public loopback 28081 with matching cloud program resources. It directly owns Python and permits a complete graceful shutdown. Seventeen real ingress checks pass after restart; controlled service downtime keeps cloud HTML available while private API/probes return uncached 502 offline responses, and the public tunnel recovers automatically. The public listener sets address reuse so consecutive restarts after real HTTP connections do not fail in TIME_WAIT (55 final ingress/architecture/restart tests pass). a second startup is rejected before database initialization. Existing public browser login, four Agent sources, historical records and live follow/pause/recovery pass read-only acceptance. The existing Qwen weights are preserved, the shared environment is rebuilt through the formal repair action, and both model workers load successfully from the new project root. The old CLI key is rejected as revoked/expired; the installed client requires the account holder to connect a valid Management API Key, without silently granting a replacement. An independent SDK wheel builds and passes sync/async installation checks outside the backend environment. Actual Mac logout/sleep and unavailable paid-provider calls are not claimed as tested.
