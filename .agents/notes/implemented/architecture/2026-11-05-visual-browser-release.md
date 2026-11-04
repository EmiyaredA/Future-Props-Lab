# Agent Note: Visual browser release

Status: implemented

## Problem

The isolated Visual container owned projects and Canvas routes but could not serve the published browser entry points.

## Decision

Build Visual's own immutable browser program using its existing pages, Workshop navigation and signed-in permissions. Serve only the registered page paths and manifest files. Compare the installed program's API digest against the published Visual contract before exposing it.

## Alternatives considered

Serving the compatibility site's frontend from the Visual image would bypass independent versioning and include unrelated application entry points.

## Consequences

Project, Canvas, project Assets and generation tasks can be opened directly through the Visual owner. Each write from an older Visual program is rejected with the shared version response. Readiness remains gated by the remaining business routes and migration.

## Verification

The independent Chromium smoke checks the entry paths and version header, 390, 768 and 1440 pixel layouts, and a persisted text node edit. The Compose run exercises the published routes through the Gateway and verifies the stale program response.
