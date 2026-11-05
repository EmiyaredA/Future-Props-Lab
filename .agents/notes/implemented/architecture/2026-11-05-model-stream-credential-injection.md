# Agent Note: Model stream credential injection

Status: implemented

## Problem

Text inference, playground SSE and realtime voice resolved provider credentials through a global
cipher. Voice origin checking also read global CORS configuration, and importing the realtime parent
package eagerly loaded both catalogue and websocket execution adapters.

## Decision

HTTP and websocket entries supply the application's decryptor to inference preparation, playground
streaming and realtime model resolution. Voice origin checks use the current application's settings.
The realtime parent package is lightweight and consumers import concrete components explicitly.

Provider plaintext stays within the server-side execution adapter. The existing authorization
watchdog, cancellation cleanup, logging and final stream settlement behavior remain unchanged.

## Alternatives considered

- A default decryptor would hide missing assembly and continue global key selection.
- Deriving credentials from browser inputs would change the ownership and authorization boundary.
- Eager parent exports couple catalogue-only consumers to websocket execution dependencies.

## Consequences

Public REST/SSE/WS contracts and ciphertext format remain unchanged. Tests replacing the realtime
execution component must implement its explicit decrypt argument; the HTTP test verifies that the
application's callable is passed, instead of accepting arbitrary keyword arguments.

## Verification

- Isolated model playground, inference, realtime origin/auth checks, permission downgrade, model
  service HTTP, provider normalization and database-session lifetime regressions cover these paths.
- Architecture gates cover migrated credential consumers; OpenAPI, ownership metadata and all 23
  source-closure entry imports are checked without live supplier credentials.
