# Agent Note: Assemble the independent Creative catalog and installation submit

Status: implemented

## Problem

The Creative catalog needs names from Identity, while an installation can complete in Integrations before Creative receives the response. A caller must also be unable to substitute a different installation body after gateway authorization.

## Decision

Both assemblies reuse the public catalog routes. The independent session queries display names through a request-bound Creative Identity peer. The Creative install handler uses the signed evidence for the original bytes, accepts a stable batch and verifies authenticated Integrations results. Retry checks the existing batch and queries its receipt before considering another submission.

The acceptance Compose overlay runs the gateway bridge on an owner-only Unix socket. Caddy authorizes the public operation before rewriting its destination and strips browser credentials. The two install directions and target receipt authentication use distinct credentials. The Creative process explicitly verifies its local migrations, and a browser build is checked against the published contract.

Installation preview delegates a separate read-only operation to Integrations. The delegated path binds the proposed batch digest, and Integrations checks the current actor before and after reading the account's installed resources and name conflicts. Preview does not create installation intents.

Source import requires the original gateway evidence and a destination assertion bound to the source kind, ID and body digest. Integrations owns the snapshot projection, including the bounded Skill ZIP and its checksum. Creative stages and verifies imported files before commit. The same attested request resolves to the same durable draft ID, while a new authorized import can create another draft.

## Alternatives considered

- Loading accounts or installed resources from the catalog's own database would couple the service to foreign tables.
- Forwarding the browser body directly to Integrations would skip Creative's batch, publication checks and durable receipt recovery.
- Exposing the bridge on the gateway control-plane TCP port would weaken its ingress boundary.

## Consequences

The catalog, source import, installation preview, submit and stdio configuration run as isolated services. Stdio uses an owned installation lookup, a destination assertion and a keyed digest of the configuration. Integrations encrypts environment values and returns an authenticated receipt. Creative advances the installed resource projection and keeps the original install receipt immutable. Project certification and historical transfer keep the release readiness check closed.

## Verification

The stdio journey discards the Integrations setup response after commit. A matching retry returns the same disabled MCP. A different command conflicts, and replaying the earlier installation preserves the configured MCP. Invalid public input responses omit environment values.

Isolated HTTP tests verify the Identity author peer and draft visibility. Creative and Integrations verify that the exact installation request can recover a lost target response without a second target write. The bridge tests exercise the owner-only socket and its cleanup and check that both website listeners authorize before forwarding to the private path.

The isolated four-service Compose journey exercises local login, publish, install and replay. The public listener serves the Creative program and rejects direct bridge requests. Chromium visits the gallery, item detail and creation pages with a mobile viewport using the same packaged browser build.

The Skill journey checks installed file content and retrieves the original receipt after withdrawal. The same isolated service images restore login, the installed file and the prior receipt after a stopped-service runtime snapshot is restored.

The source journey imports an owned Tool API and Skill archive through Caddy. The Identity scenario rejects missing or modified request evidence and repeats an attested request without fetching the source twice.
