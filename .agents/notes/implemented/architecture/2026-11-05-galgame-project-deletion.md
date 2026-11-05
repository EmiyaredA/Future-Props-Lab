# Agent Note: Galgame project deletion

Status: implemented

## Problem

The standalone Galgame owner could not delete a project because its Story, frozen snapshots and project originals span Galgame and Assets.

## Decision

Use the exact project deletion URL to prepare a tombstone for the current Story revision. Assets fences new Story references and project file writes and verifies that unrelated consumers do not hold the originals. Galgame checks the expected project revision and the Story revision again, then commits the project deletion and durable Assets outcome together. Assets removes only the project's originals after the source outcome commits.

## Alternatives considered

Deleting files first would allow a stale project request to lose originals. Deleting the source first without a durable file outcome could leave its originals unowned after a restart.

## Consequences

Deletion keeps the published project conflict and removal contracts. Open uploads, jobs and unrelated file references block deletion until their outcomes are known. Ordinary account library files remain available.

## Verification

Signed tests cover stale project versions, a competing application pin, dropped deletion acknowledgement and recovery, plus continued library download. Five isolated containers and Chromium exercise a completed project, restart and deletion through the Gateway.
