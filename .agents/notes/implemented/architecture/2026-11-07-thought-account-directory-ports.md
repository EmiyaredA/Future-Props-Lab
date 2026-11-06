# Agent Note: Remove Thought account directory discovery from SQL sessions

Status: implemented

## Problem

Private edits, history and table personnel read an Identity client out
of the SQLAlchemy session. A source session then inherited the same
request dependency through copied metadata.

## Decision

Bind Identity once per authenticated request. Pass the directory to
edit history, publication authorization, imports and table personnel
queries. The compatibility adapter can rebind to the source transaction.
The independent adapter retains its authenticated short-lived snapshot
and existing refresh points. Session metadata carries storage scope.

## Alternatives considered

Resolving Identity globally or using ambient request state would still
hide the actor, authority and lifetime of each request.

## Consequences

History keeps the existing display name, and private and community writes
keep their account checks and CAS. Architecture checks reserve application
session metadata for account scope and storage access flags.

## Verification

Compatibility and independent tests cover author history, archive and
official imports, account access, table personnel, community revocation
and attachment evidence.
