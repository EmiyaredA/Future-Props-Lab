# Agent Note: Move historical Models catalogs with their original credentials

Status: implemented

## Problem

Copying model selections or reissuing provider keys would lose original catalog IDs, references, revisions and usable credentials during service promotion.

## Decision

Models exposes loopback maintenance datasets for suppliers, providers, entries and catalog revisions. Imports check account-scoped relationships before storing records. They verify provider ciphertext with the destination deployment key and persist the unchanged ciphertext and batch receipt. The transfer client compares complete source and destination pages.

## Alternatives considered

- Sharing the old catalog database would bypass ownership and runtime boundaries.
- Revealing provider keys during transfer would introduce an unnecessary plaintext path.

## Consequences

The same key must be carried forward. Task and log history remain separate migration dependencies. Account defaults and supported platform policy partitions are migrated after the directory. Unknown platform settings still block the source coverage gate.

## Verification

The isolated compatibility site creates a supplier and configured provider through normal APIs. The rehearsal verifies the catalog import, repeat receipt and rejection with a different key. The restored old site returns the original catalog.

The policy rehearsal writes a default model selection, quota, encrypted role template and demo setting through the compatibility APIs. It compares source and destination receipts for both partitions and checks the restored values and revisions.
