# Agent Note: Explicit Interview file ownership

Status: implemented

## Problem

Interview Rooms selected its material root from Session.info and then fell back to global settings.
The independent application injected this hidden service locator, while website task preparation
selected the global root separately. Upload compensation also deleted files after any commit error,
including acknowledgement loss after a successful database commit.

## Decision

Rooms, file path functions and task-context preparation require an explicit root. Website and
independent HTTP assembly supply their own root; the website runner receives the same value.
Database sessions retain account isolation, with no file configuration lookup.

Before commit starts, a failed upload removes its new file. Once commit begins, errors and
cancellation preserve the immutable private copy because a durable record may already reference it.
The next room snapshot determines whether the material committed. An unreferenced uncertain copy
remains private and is reclaimed when the owner deletes the room; it is never exposed or resubmitted
automatically. No persistent schema or directory format changes.

## Alternatives considered

- Session configuration hides a dependency and lets the wrong session factory choose storage.
- Deleting every failed upload can destroy an already committed material.
- Repeating a commit after an unknown result risks duplicating the user's operation.

## Consequences

Both entry styles use the same room operations and explicit file selection. This change does not
claim that the remaining CLI adapter, ORM-backed room workflows or runner are fully decomposed.
Unconfirmed uploads can retain a private orphan until room deletion, favoring durable data over
eager reclamation.

## Verification

Website and independent room/material flows, transfer and restart tests cover the same operations.
An isolated database test poisons the historical Session locator, exercises errors and cancellation
before and after actual commit, verifies snapshot/file consistency and checks room deletion cleanup.
The live CLI test remains opt-in; controlled subprocess tests exercise ordinary preparation.
