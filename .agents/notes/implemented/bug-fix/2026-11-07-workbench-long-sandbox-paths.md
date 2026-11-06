# Agent Note: Keep long project paths compatible with the macOS command sandbox

Status: implemented

## Problem

The project path was expanded into one regular-expression character class
per ASCII letter. On long absolute paths the resulting string can exceed
the Seatbelt parser limit and prevent even an authorized preset from running.

## Decision

Constrain the deny rule with the native project subpath filter. Match
private names and suffixes only after the project's ancestor components.
This keeps the case-insensitive checks for private entries and keeps the
regular expression independent of the length of each ancestor name.

## Alternatives considered

The absolute-path regular expression duplicates the project's subpath and
grows with each directory name. A deny pattern over the entire absolute
path would incorrectly reject projects under a hidden ancestor directory.

## Consequences

The preset still reads within its approved project and still rejects
hidden entries and private suffixes. Existing command and write scopes
retain their rules.

## Verification

The real macOS sandbox opens a normal file beneath a long project path
with a hidden ancestor, then rejects a hidden file, a child of a hidden
directory, and an uppercase certificate suffix.
