# Agent Note: Galgame project uploads

Status: implemented

## Problem

The Galgame browser could list and inspect original files but still sent single and batch uploads to the compatibility application.

## Decision

Galgame reserves a project-scoped plan with the original naming and collision rules. It persists the exact signed Assets destination before streaming a size- and digest-bound manifest and its files. Assets journals each batch's storage keys before staging bytes and commits all rows and the file receipt together. The Galgame intake settles owned metadata from that receipt. Restart recovery removes interrupted Assets files with no commit receipt and reads committed results without sending the files again.

## Alternatives considered

Registering files individually would allow a partly invalid upload to leave visible records and ambiguous filenames. Sending raw files and accepting a new result after a timeout could duplicate originals.

## Consequences

Single and batch uploads keep their public multipart fields and output contracts. Reservations serialize concurrent naming, and a metadata scan between remote commit and local settlement does not replace the reserved paths. An unknown outcome retains its reservation until Assets can prove the result.

## Verification

The isolated API test uses real PNGs, rejects a mixed valid and invalid batch, drops a successful response, restarts the Galgame app and checks exact digests and names. An interrupted staging fixture verifies removal of uncommitted bytes. The Compose journey checks single and batch upload, restart and original downloads.
