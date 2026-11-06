# Agent Note: Share Thought exports through an explicit asset reader

Status: implemented

## Problem

Thought conversion and export discover the asset reader through the
database session. The two backup entry points assemble the same archive
with different read paths and validation.

## Decision

Both HTTP assemblies supply a reader bound to the authenticated account.
One backup implementation collects the Thought snapshot before downloading
versioned assets and enforcing archive limits. The website takes its
limits from deployment settings. Note export waits for a cancelled archive
writer to finish before deleting its temporary files.

## Alternatives considered

Keeping the local archive writer would keep format, limit and error handling
split across two assembly paths.

## Consequences

Conversion and exports use the same input port with local or independent
storage. The archive manifest and routes retain their existing format.

## Verification

Thought archive, history, Markdown, canvas and independent route-contract
regression tests exercise both assemblies.
