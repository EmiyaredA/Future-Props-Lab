# Agent Note: Run Interview rooms and materials in their own service

Status: implemented

## Problem

Interview room records, original materials and preparation histories need an owner that can run behind the signed gateway. The compatibility route uses a host Codex process and its own database session.

## Decision

The shared routes obtain the file root and executor status port from their scoped session. Compatibility binds its existing runner. Interview binds an explicit unavailable executor until the Mac worker is connected. The independent process owns rooms, materials, preparation rows and request receipts. Startup interrupts unfinished work. The production readiness endpoint remains closed.

## Alternatives considered

- Including the compatibility runner in the image would introduce its database and host CLI dependencies.
- Copying the public routes would risk contract drift between the two entry points.

## Consequences

The independent browser program opens on the published route and preserves navigation guards. The service can receive and return account-private originals. The remaining work covers native execution and historical transfer.

## Verification

API tests compare the published contract, exercise revision conflicts, replay a creation receipt and verify cross-account isolation after restart. The installed Gateway, Identity and Interview stack confirms file bytes, public entrance restrictions, stale web build rejection and responsive Chromium navigation.
