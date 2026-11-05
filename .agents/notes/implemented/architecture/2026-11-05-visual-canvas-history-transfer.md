# Agent Note: Visual Canvas history transfer

Status: implemented

## Problem

A separate Visual target must preserve the compatibility site's projects, Canvas revisions and all output versions. Library placement metadata and original files belong to Assets.

## Decision

Transfer Visual projects, raw Canvas documents and node outputs as typed owner batches. Read compatibility placement rows through Assets maintenance, validate account, folder and library relationships, and retain their identifiers and revisions in the new link table. Visual exports its current and historical file pins. Assets verifies their scopes and previously imported SHA256 receipts before accepting them. The independent Visual schema removes the unused placement table only when it is empty.

## Alternatives considered

Rebuilding a Canvas from its final selections would lose output versions and original media still needed by earlier results. Copying the compatibility tables wholesale would leave Visual and Assets with two independent placement records.

## Consequences

The migrated Canvas and output versions keep the original IDs, timestamps, revisions and selected outputs. The existing isolated migration protocol verifies readback and replays identical batch receipts. Assistant records and provider task history require their own transfers.

## Verification

A real isolated compatibility website creates Canvas media, two library placements and output versions. Separate Visual and Assets maintenance listeners verify exact records, pins, original PNG digests and repeated import. The verified original snapshot starts the compatibility site again and serves the same Canvas and file bytes.
