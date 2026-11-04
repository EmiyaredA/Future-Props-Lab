# Agent Note: Certify projects in their owning applications

Status: implemented

## Problem

The published certification endpoint belongs to Creative. Visual and Galgame own the revisioned project rows, while Identity owns the account audit log. The compatibility site could update all three concerns inside one SQLite transaction.

## Decision

Creative accepts the original browser operation and obtains a narrowly signed command from Identity. The command carries one project kind and ID, one expected revision, one requested flag and one stable request ID. Identity binds it to the administrator account and the trusted gateway's client IP. The owner service checks the live authorization before a new write. It applies the revision check under its SQLite write lock and saves the project and pending audit outcome in the same transaction. Identity accepts that outcome only from the registered owner service and signs its durable audit receipt. Creative verifies the signed receipt before returning success. After confirmation the owner drops its mutation authority and keeps the result and receipt for replay.

## Alternatives considered

- Loading either project ORM into Creative would bypass ownership and require access to another database.
- Adding a Creative shadow flag would let the published marker drift from the project's revision.
- Writing an audit event before the owner commits would allow rejected and conflicting operations to appear successful.

## Consequences

Visual and Galgame now have explicit initial owned schemas with external identifiers and local audit receipts. Their independent ASGI assemblies expose the project catalog and initial editor reads under the published contract. Each owner commits project creation with its initial Canvas or Story and serves the certification marker from that same project row. Asset Storage creates file directories when files are written. Full editor workflows, browsers, workers and installed readiness remain under the project-service work. Creative startup validates the full 16-operation release contract and its readiness stays gated.

## Verification

Isolated HTTP tests use actual Creative, Identity, Visual and Galgame assemblies. They cover administrator permission, account ownership, CAS conflict, a mismatched signed command, post-authorization logout, invalid audit outcome and audit acknowledgement loss across target restart. The SQLite test checks each owner's migration tables against the service catalog and verifies its local foreign keys. The audit log keeps the trusted client IP and records the committed change once. Both public owner endpoints return the committed certification marker and revision after an acknowledged change or a lost audit acknowledgement.
