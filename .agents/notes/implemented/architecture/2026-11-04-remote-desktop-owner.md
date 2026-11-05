# Agent Note: Run the desktop tunnel in its Remote owner

Status: implemented

## Problem

The desktop WebSocket previously used the compatibility server's session, desktop settings and file layout. The Remote process needs its own preference storage and scoped authorization while preserving the browser protocol.

## Decision

Remote owns idle preferences and the in-memory, one-use ticket. Identity signs only the ticket digest on the designated upgrade. The gateway strips cookies before forwarding. Remote compares the ticket against the exact account, session, listener and encrypted factor generation. It checks the live session and factor generation during the stream. Both deployments reuse the same Guacamole bridge with their own settings, authority and upstream ports.

## Alternatives considered

- A shared database would let Remote read account credentials.
- A long-lived browser credential in the WebSocket upstream would widen access after upgrade.
- Keeping tickets beyond the connection process lifetime would require persisting the VNC password.

## Consequences

Remote installs with a dedicated preference database and a minimal read-only transport configuration. The connection target comes from the deployment, and the browser supplies only a password. Configuration coordination and formal data verification still gate production readiness. The loopback maintenance entry transfers historical idle values and revisions under the shared verified account plan. It commits the preference and its durable receipt together.

## Verification

The isolated test uses real TCP to a deterministic Guacamole peer and genuine Identity assertions. It verifies the owned idle preference revision, invalid origin, consumed ticket, allowed keyboard frame and logout-triggered close. The installation run also exercises the actual Gateway WebSocket upgrade and verifies the preference after Remote restart.

The compatibility snapshot rehearsal saves a nondefault preference through the public API, imports and replays the batch through the independent maintenance listeners, and verifies the same value and revision after restoring the old site.
