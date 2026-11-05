# Agent Note: Annotation transcription ports

Status: implemented

## Problem

The website and independent Annotation executors each invoked a storage helper that combined SQL
with project-range rules. The website bridge lived in the application and accessed Model internals;
the Model transcription engine also loaded its encryption key through a global settings function.

## Decision

`TranscribeSegment` owns project authorization and range validation for both direct uploads and
saved-segment recognition. An owned storage port returns an immutable owner/duration snapshot
and releases its read transaction. Invalid input closes the stream before any model attempt.
The executor port receives explicit ownership and transcription parameters; unknown outcomes
propagate without an automatic retry and all exit paths close input.

The independent adapter no longer receives a Session and checks its signed actor against the
owner. Website cross-table composition lives in `assembly/website/annotation_transcription.py`.
Model transcription receives a decrypt callable constructed by each assembly, and its private
protocol entry uses the assembled factory. Existing Model validation, call logs and persistent
attempt receipts remain with Models.

## Alternatives considered

- A shared helper receiving Session would keep the business rule coupled to ORM.
- Copying range checks into both model adapters would permit divergent entry behavior.
- A default global decrypt fallback would hide incomplete assembly and prevent replacement.

## Consequences

Both Annotation entry paths use one rule implementation. Public HTTP and private protocol formats
are unchanged. The Model engine's broader storage/provider separation remains part of the Model
Service migration; this change only removes its implicit decryption dependency for transcription.

## Verification

- Annotation website/independent APIs, Models protocol, saved media ports and Studio checks:
  40 passed, using controlled providers and isolated databases.
- Pure port cases cover missing/foreign ownership, invalid range, stream closure, one successful
  attempt and one unknown outcome without retry: 7 passed.
