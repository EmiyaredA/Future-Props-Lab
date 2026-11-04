# Agent Note: Preserve Visual and Galgame edit receipts

Status: implemented

## Problem

A retry of an edit accepted by the old site needs the original saved response after the project moves to its standalone owner. Migrating the current Canvas or Story alone cannot replay an earlier successful operation.

## Decision

The Visual and Galgame maintenance apps move their separate partitions of `project_operation_receipts` after the corresponding documents. `fpl_runtime/edit_receipt_migration.py` pages by project ID and the hexadecimal UTF-8 request ID and keeps the original response JSON, digest and timestamp. It checks that the legacy project belongs to the same account, that both source and destination have the corresponding document, and that the saved response has the expected shape and does not exceed its current revision. Each import commits with the usual durable batch receipt. Unknown resource kinds remain pending in migration coverage.

## Alternatives considered

Recreating a receipt from the latest document would discard the original version and response. Copying the whole shared table would transfer other owners' rows and bypass the source relationship and batch checks.

## Consequences

A retry of the old operation can return its original response after further edits. Using the same request ID with a different payload still conflicts. An unassigned account, orphan receipt, malformed response or response beyond the current revision blocks transfer.

## Verification

The two isolated history rehearsals create receipts through the compatibility website and migrate from a sealed source. They test replay via the independent public HTTP operation, a changed request and another account. Both restore the compatibility website from the same snapshot and recheck the current document and original files.
