# Agent Note: Galgame browser release

Status: implemented

## Problem

The Galgame owner had Story and project APIs but the public browser paths still depended on the compatibility program.

## Decision

Build a manifest-backed program from the existing Galgame project, overview, editor and preview pages. Use the shared signed-in permissions and preserve the preview's saved Story fallback. Verify the installed Galgame program against its published API contract.

## Alternatives considered

A separate implementation would duplicate editor, preview and read-only behavior. Serving an unversioned browser entry would let stale editor writes bypass the shared build response.

## Consequences

All four published page paths work from the independent owner. The service continues to report incomplete readiness until the remaining operations and history are verified.

## Verification

The four-service Compose run checks the Chromium routes at three widths, legacy Story import, original bytes, project readiness, stale write rejection and preserved state after service restarts.
