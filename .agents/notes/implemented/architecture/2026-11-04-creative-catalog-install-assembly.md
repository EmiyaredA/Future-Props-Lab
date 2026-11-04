# Agent Note: Assemble the independent Creative catalog and installation submit

Status: implemented

## Problem

The Creative catalog needs names from Identity, while an installation can complete in Integrations before Creative receives the response. A caller must also be unable to substitute a different installation body after gateway authorization.

## Decision

Both assemblies reuse the public catalog routes. The independent session queries display names through a request-bound Creative Identity peer. The Creative install handler uses the signed evidence for the original bytes, accepts a stable batch and verifies authenticated Integrations results. Retry checks the existing batch and queries its receipt before considering another submission.

The acceptance Compose overlay runs the gateway bridge on an owner-only Unix socket. Caddy authorizes the public operation before rewriting its destination and strips browser credentials. The two install directions and target receipt authentication use distinct credentials. The Creative process explicitly verifies its local migrations, and a browser build is checked against the published contract.

## Alternatives considered

- Loading accounts or installed resources from the catalog's own database would couple the service to foreign tables.
- Forwarding the browser body directly to Integrations would skip Creative's batch, publication checks and durable receipt recovery.
- Exposing the bridge on the gateway control-plane TCP port would weaken its ingress boundary.

## Consequences

The catalog and installation submit can run as isolated services. Source import, installation preview, stdio configuration, and historical transfer still keep the release readiness check closed.

## Verification

Isolated HTTP tests verify the Identity author peer and draft visibility. Creative and Integrations verify that the exact installation request can recover a lost target response without a second target write. The bridge tests exercise the owner-only socket and its cleanup and check that both website listeners authorize before forwarding to the private path.

The isolated four-service Compose journey exercises local login, publish, install and replay. The public listener serves the Creative program and rejects direct bridge requests. Chromium visits the gallery, item detail and creation pages with a mobile viewport using the same packaged browser build.
