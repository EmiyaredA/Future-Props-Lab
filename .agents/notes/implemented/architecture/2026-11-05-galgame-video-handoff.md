# Agent Note: Hand off editable Galgame timelines to Video Editor

Status: implemented

## Problem

A Galgame handoff needs an editable Video timeline, its exact originals and generated layers. A lost reply must resolve to the same Video project.

## Decision

Galgame commits its Story snapshot and handoff dispatch together. Rendering seals a portable Video archive with source project and revision, the compiled timeline and every used media file. Video validates the archive and binds the first admitted checksum to the source task. Video stages and publishes through its own Assets archive outcome. Galgame stores a private receipt assertion before publishing so that it can recover a committed destination after the original Session ends.

## Alternatives considered

Sharing a database would bypass account and project ownership. Sending the rendered MP4 would discard editable tracks. Treating every retry as a new snapshot copy would duplicate the destination after a lost reply.

## Consequences

The published handoff task keeps the existing title, provenance and track and asset counts. Cancellation can stop work before Video commits its publication. A committed Video copy is recovered through its existing receipt. Galgame enables its production readiness probe only with all published operations, a matching browser build, an archive key and healthy local workers.

## Verification

Signed tests verify a real timeline, one destination after losing the response, reconciliation after logout, and cleanup of the Galgame source without deleting the Video project. The isolated Compose rehearsal opens the handed-off project in Chromium and reads the same destination and timeline after service restart.
