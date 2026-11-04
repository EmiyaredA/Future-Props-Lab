# Agent Note: Run account tool navigation in its owning service

Status: implemented

## Problem

Tool favorites and recent use are private account state. The compatibility site previously wrote them in the central SQLite database. The separate Tools process must preserve ordering and exact usage counts under concurrent writes.

## Decision

The published navigation router runs under a destination-bound Identity assertion and opens the Tools database only. Both deployments use the same account-checked ORM model. An immediate SQLite transaction serializes lookup and update of the account and tool key. A favorite change preserves the counter and a usage update preserves the favorite. The Tools image copies only its source closure and mounts its state and Identity public key.

## Alternatives considered

- Using a monolith database session from the Tools process would bypass service ownership.
- Splitting favorites from usage would duplicate the account and tool key and complicate a consistent listing.
- Allowing unrestricted SQLAlchemy bulk inserts in the shared service session would bypass its owner checks.

## Consequences

The navigation API has an installed isolated image. The immutable browser release serves the tool directory and two existing deep links. The image verifies the browser contract hash and rejects writes from mismatched program versions. A separate local browser action uses a short native lease for a fixed account-library folder. The Tools service rechecks the original Identity session and exposes only a sanitized lease. The Mac worker checks the resolved account path under the configured Assets root and persists the execution receipt before acknowledgement. The existing video dependency check asks the same worker to probe the two fixed executables. Public callers get availability and versions with local executable paths removed. Video download jobs use the same native lease with a typed URL and quality. The Mac worker persists a descriptor before transfer. Tools checks length and SHA-256, stores its own immutable artifact receipt, and delegates optional library ingestion to Assets with an account-, folder- and digest-bound grant. The worker retries delivery from its persisted receipt and does not rerun the provider download. Historical import and the final deployment orchestration are required for Tools readiness. Public readiness remains gated until those paths pass.

## Verification

Isolated HTTP tests cover signed authorization, concurrent increments, persistence across app restart, account separation and exact published operation shapes. The existing compatibility route and architecture tests continue to cover the original entry point.

An installed three-container run exercises navigation through Gateway, then restarts only Tools and reads back the exact favorite and usage state.

Chromium verifies the signed-in mobile directory, favorite mutation and deep links through the installed stack. The isolated public listener serves the browser program and requires authentication for navigation state.

Host protocol tests cover public administrator rejection, spoofed native ingress, known expiry before assignment, verified path resolution and lost acknowledgement followed by receipt replay without another invocation.

The installed video test uses a deterministic MP4 fixture. It reads the same bytes through the browser download and Assets routes, then restarts Tools and checks the stored result. The raw video descriptor header avoids the gateway’s reserved identity-header namespace. Browser cookies are requested only from the local browser lane.
