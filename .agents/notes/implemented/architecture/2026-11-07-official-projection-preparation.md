# Agent Note: Bound concurrent official archive projection preparation

Status: implemented

## Problem

Preparing an empty Assets projection for every official article serializes
many independent authorizations and short transactions. Under load the
same live request can exhaust its source assertion before preparation ends.

## Decision

Prepare at most four independent projections per batch. Validate the
attachment-free manifest before any preparation, retain every successful
preparation for rollback and perform the existing live authority check
before the source writes.

## Alternatives considered

Increasing the signed assertion lifetime would alter request authority
outside this operation. Starting every projection at once would make
storage contention and outstanding work proportional to package size.

## Consequences

Each prepare still has its own durable intent and exact authorization.
A failed batch retains its successful results for the existing abort
flow. The source transaction and archive format retain their contracts.

## Verification

The real independent import runs through Identity, Assets and Thought.
A fault in one projection confirms the successful sibling is aborted.
Archive import also exercises a failure on its second staged document.
