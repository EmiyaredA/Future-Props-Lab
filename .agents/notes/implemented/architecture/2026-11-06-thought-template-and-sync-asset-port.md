# Agent Note: Inject readers for Thought templates, copies and previews

Status: implemented

## Problem

Templates, document duplication and article previews discover the asset
reader through a database session. The same mechanism serves the library
snapshot API, coupling validation to connection state.

## Decision

The entry points pass an account-bound reader to reusable content,
article preview and library export. The same reader validates the
original and copied document assets. Independent reference preparation,
CAS and source outcome records keep their established ordering.

## Alternatives considered

Resolving readers inside each storage adapter would require those
adapters to recover the requesting account and service credentials.

## Consequences

Asset verification has an explicit input in both assemblies. Empty
reference sets require no metadata query.

## Verification

Template creation and application, reference recovery, article sync,
library snapshot and architecture regressions exercise the affected paths.
