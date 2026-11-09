# Agent Note: Compact remote app controls

Status: implemented

## Problem

The remote app toolbar competes with the streamed window for space. App tabs, idle timing, and view controls occupy the header even when the user only needs the remote window.

## Decision

The cloud heading contains the host, connection state, disconnect action, and window selector. The app list scrolls at the viewport edge while the trusted local catalog action stays visible. Fit and fullscreen controls overlay the connected viewport and appear on hover or keyboard focus, with a persistent touch affordance.

Cloud settings exposes the account's existing idle preference. The local dialog also exposes host configuration. Public settings uses the existing desktop policy for the preference and leaves host configuration to trusted local requests.

## Alternatives considered

- A persistent viewer toolbar keeps all controls visible and consumes a row of the remote display.
- Local-only idle settings would remove access to the preference from eligible public accounts.

## Consequences

Existing session, input, and preference endpoints continue to enforce their existing policies. Standalone desktop retains its own toolbar.

## Verification

The cloud control browser suite covers narrow tab scrolling, viewer controls during a simulated connection, and idle preference access from both entry points.
