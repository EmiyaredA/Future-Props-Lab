# Agent Note: Galgame transcript edits and voice matching

Status: implemented

## Problem

The independent Galgame owner could read ASR settings and history, but manual transcript edits and matching a voice recording to dialogue still depended on the shared database.

## Decision

Delegate a transcript write's file check to Assets with an exact project and file target. Galgame owns the transcript revision and commits the saved result in its own transaction. The published voice matching rules consume account project files and owned transcripts. Matching creates new Story references through the existing prepare and commit path.

## Alternatives considered

Duplicating matching would let the two assemblies choose different assignments for the same transcript. Directly updating Story JSON would leave new voice references unprotected from file deletion.

## Consequences

The published transcript write and voice matching operations run independently. Stale edits preserve the existing conflict responses. Voice files remain pinned when Assets and Galgame settle their Story receipt.

## Verification

The signed regression uses a real isolated WAV, confirms manual transcript CAS and foreign-file denial, matches it to an existing line, and checks the saved Story and Assets pins after the reference worker restarts.
