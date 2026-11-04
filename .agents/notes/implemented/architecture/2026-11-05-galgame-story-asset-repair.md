# Agent Note: Galgame Story asset repair

Status: implemented

## Problem

A Galgame Story using the independent service could report a missing file but its existing repair endpoint still depended on the compatibility application.

## Decision

Share the Story file replacement and media-kind check. Galgame requests metadata for exactly one candidate ID. Assets admits current-project files and files from the current account's library. The signed source endpoint, project, file ID and query digest are checked before the lookup. Galgame then saves through the existing Story CAS and durable reference protocol. Pins for saved snapshots stay in the retention set.

## Alternatives considered

Using the general file list would require transferring unrelated metadata and would broaden the cross-service grant. Writing a separate Story repair transaction would bypass the existing reference preparation and restart handling.

## Consequences

Repair retains the stable Story asset ID and advances its document revision. Foreign project files and mismatched types fail before persistence. A stale repair returns the current document.

## Verification

Signed integration tests cover successful repair, wrong type, unknown Story asset, cross-account and cross-project files, stale revision and history pins after worker recovery. Published OpenAPI equality and architecture checks cover route and image boundaries.
