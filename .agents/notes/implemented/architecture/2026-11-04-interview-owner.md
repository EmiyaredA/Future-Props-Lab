# Agent Note: Run Interview rooms and materials in their own service

Status: implemented

## Problem

Interview room records, original materials and preparation histories need an owner that can run behind the signed gateway. The compatibility route uses a host Codex process and its own database session.

## Decision

The shared routes obtain the file root and executor status port from their scoped session. Compatibility binds its existing runner. Interview binds the scoped Mac worker when native transport is configured. It otherwise reports the executor unavailable. The independent process owns rooms, materials, preparation rows and request receipts. Startup interrupts unfinished work. The production readiness endpoint remains closed.

## Alternatives considered

- Including the compatibility runner in the image would introduce its database and host CLI dependencies.
- Copying the public routes would risk contract drift between the two entry points.

## Consequences

The independent browser program opens on the published route and preserves navigation guards. The service can receive and return account-private originals. The native transport accepts only preparation leases and validates the active account and frozen input throughout execution. The remaining cutover work covers historical transfer and real Codex provider acceptance.

## Verification

API tests compare the published contract, exercise revision conflicts, replay a creation receipt and verify cross-account isolation after restart. The installed Gateway, Identity and Interview stack confirms file bytes, public entrance restrictions, stale web build rejection and responsive Chromium navigation.

The native rehearsal sends a frozen resume to a synthetic host executor. It drops the first acknowledgement, restarts the worker, and verifies that the worker replays the durable receipt without executing again. The normal endpoints expose the saved progress and export. The rehearsal also disables an account during a second lease and verifies that its execution authorization ends.
