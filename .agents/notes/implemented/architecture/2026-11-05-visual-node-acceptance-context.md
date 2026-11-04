# Agent Note: Resolve Visual node acceptance context within owned scopes

Status: implemented

## Problem

Node acceptance context needs the actual output version, generation provenance, reference media and chosen scheme. The standalone Visual service owns the Canvas and acceptance records while Assets owns file metadata and availability.

## Decision

The existing context and fingerprint rules now take a batch metadata port. The compatibility website uses its existing storage adapter, while Visual requests only the exact asset IDs for the authorized project. Assets validates the actor, project and digest, and resolves only project originals and file library placements. Scheme selection holds a short local write lock, rechecks the video node and creates its binding through the account-scoped ORM before the revision check. Summary construction reuses the context rules and skips executor probes when only result freshness is required.

## Alternatives considered

Sharing the Assets database would bypass account and file ownership. Probing the Mac worker once per summary item would add latency without changing a historical result's context fingerprint.

## Consequences

The three published operations retain their original shapes, statuses and operation IDs. The metadata transport uses a private POST with read authority. Its grant cannot retarget another project or access file contents. Revision conflicts return the current node acceptance snapshot.

## Verification

The signed regression selects a fixed scheme for a real project, checks its character, motion and output IDs, reads the same fingerprint again, and exercises a stale update and a different-project grant. The container rehearsal uses an actual video upload and reads the same context and summary after restarting the owners.
