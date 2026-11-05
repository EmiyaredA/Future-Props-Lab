# Agent Note: Models browser release and explicit websocket ownership

Status: implemented

## Problem

The independent deployment catalog describes HTTP only. Realtime voice cannot reach Models through the gateway, while treating its handshake as an ordinary GET would widen routing and authentication. Browser build reuse also ignores the service API digest, so an unchanged frontend can retain a manifest incompatible with a newly changed service.

## Decision

Keep a separate fixed websocket ownership list. Match a real GET Upgrade handshake, strip external FPL headers and set the trusted websocket protocol before Identity authorization. Route only through the Studio ingress, pass the signed request to Models and remove raw cookies and credentials. Ordinary HTTP requests to the socket path retain 404. Include only this service's socket contract in its program API digest.

Build Models as an independent browser program with its own catalog, model test and log routes. Reuse the existing feature pages, current account permissions, readonly test result view and document navigation protection. Program resources include the required provider marks and voice assets. Include the service API digest in immutable browser build IDs before cache lookup.

Package Models from its statically audited source closure and a dependency lock. The optional Compose overlay mounts only owned state and protected configuration, with private service traffic and a separate provider egress network. Command-line and Mac management controls use one exact Compose prefix with dotenv disabled. Only a Models image selected in deployment TOML enables the overlay, and startup checks its registered migrations without applying them.

## Alternatives considered

- A fake public GET for a websocket loses the actual protocol boundary and pollutes OpenAPI.
- Routing to the recovery monolith keeps the voice session coupled to the portal lifecycle.
- Hashing only browser source misses backend contract changes; hashing all services' protocol data needlessly invalidates independent versions.
- Mounting the whole backend or host model directory violates service and native execution ownership.

## Consequences

Models pages and voice can be independently released, but this does not complete native MLX, central audit delivery, all other application services or formal data transfer. Formal installation remains gated on their acceptance. No production database, configuration or running process is changed by these isolated checks.

## Verification

Seven browser component checks cover independent permissions, read-only results, account logs, deep links and unsaved navigation. Thirty-four packaging/host checks verify storage rejection, mounts and explicit release selection. Forty-one gateway/web/host checks verify websocket ownership, ordinary HTTP rejection and service-local compatibility. The generated socket configuration passes validation in the actual Caddy image. Actual eight-service acceptance `fpl-isolated-agents-2de47b1cb3` passes the complete Models HTTP/socket/native/output path; the following nine-service run `fpl-isolated-agents-e308095503` adds Integrations, native stdio and shared capacity settlement. Models has 18 responsive/theme screenshots. The final model-test screenshot verifies compact chat width, not only document overflow.
