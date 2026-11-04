# Agent Note: Run Thought as an installed service

Status: implemented

## Problem

Thought's independent routes and recovery workers need an installed entry with its own SQLite state and versioned browser program. The compatibility site's file adapter imports the Assets ORM and must stay outside Thought's image.

## Decision

Package Thought's reachable modules, the existing official package seed, and the immutable browser build. The startup entry accepts only Thought storage and file limits, checks the exact route and operation ID inventory, validates the browser contract hash, and refuses unmigrated or drifted SQLite data. Readiness requires the configured upload peer and running recovery workers. The explicitly selected Compose overlay mounts a read-only peer configuration into Thought and Assets, with separate credentials for source evidence and receipt authentication. Compatibility file endpoints use an explicit old-site adapter outside the image.

## Alternatives considered

- Copying the compatibility site's application tree would give the independent container access to foreign ORM implementations and credential configuration.
- Allowing startup to apply migrations would bypass deployment preflight and the cutover rehearsal.
- Putting the Thought service directly in the base Compose file would require existing isolated deployments to select its image and credentials immediately.

## Consequences

The service can be built and exercised against isolated Identity, Assets and Gateway containers. The normal independent launch only selects the overlay from explicitly configured deployment inputs. Formal data migration and site-wide cutover still have their own gates.

## Verification

The packaging and host tests assert the source closure, explicit overlay selection and mount boundaries. The isolated Compose check verifies readiness, browser release selection, stale-build write rejection, image transfer, backup bytes, archive replay and official package availability. Its Chromium option opens the signed-in page and a real note deep link at a mobile viewport.

The community read grant also binds the requested thumbnail size. Assets reuses the existing bounded decoder and account-scoped revision cache after authorization. The isolated HTTP test checks real WebP dimensions, original bytes and denial after access is revoked.
