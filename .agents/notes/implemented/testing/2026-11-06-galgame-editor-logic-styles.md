# Agent Note: Separate Galgame editor logic and layout checks

Status: implemented

## Problem

The full Web run timed out in Galgame editor behavior tests. In a reproduced
stage-preset timeout, jsdom spent about seven seconds in computed-style calls.
The CSS cascade also slowed the role queries that wait for lazy workspaces.

## Decision

Replace the aggregate Galgame styles module in five editor behavior test
files. Keep their interactions and persistence assertions. Select the resource
reference drawer by its collapsed state. The browser authoring tests continue
to exercise the real cascade, and component tests with direct layout assertions
retain their styles.

## Alternatives considered

Extending the timeout would preserve the jsdom cascade cost. Excluding all
Galgame styles affected the separate video export geometry assertion.

## Consequences

The editor behavior checks now exercise a smaller stylesheet set. CSS layout
and responsive geometry rely on the real-browser checks.

## Verification

The five editor files and the video export file passed 56 tests. The Chrome
authoring suite passed three browser tests on an isolated website.
