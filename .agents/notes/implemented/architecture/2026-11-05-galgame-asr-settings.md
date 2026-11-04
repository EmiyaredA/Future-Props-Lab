# Agent Note: Galgame ASR settings and task records

Status: implemented

## Problem

The independent Galgame owner had ASR settings and task tables but its published configuration and history routes still depended on shared Models storage.

## Decision

Share the project-scoped setting and task queries and the setting CAS. The independent owner asks Models only whether one account model supports transcription. Identity delegates the exact request, and Models checks the session and owns the catalog query. A settings write verifies the intended model before it changes the project row.

## Alternatives considered

Looking up provider rows in Galgame would cross the storage boundary and expose catalog implementation details. Persisting an eligibility flag would grow stale after a provider or model is disabled.

## Consequences

Galgame supports reading, updating and clearing project ASR configuration, and listing retained transcription tasks. The separate provider execution and result materialization flow remains to be integrated.

## Verification

Signed integration tests verify eligible and foreign models, the default state, a revision conflict, clearing a model and isolation of completed task history. Compatibility asset tests preserve the existing response and runner behavior.
