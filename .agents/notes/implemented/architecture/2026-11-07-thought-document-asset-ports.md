# Agent Note: Bind document and community asset readers explicitly

Status: implemented

## Problem

Document and table validation discover asset readers in database session
metadata. The account in that session may belong to the publication
source rather than the authenticated browser editor.

## Decision

Private document, library and table writes receive the request's asset
reader. A compatibility website community write receives a source-reader
factory and binds it only after the publication is authorized. An
independent community write continues to validate against its prepared
asset snapshot. The transaction and CAS retain their original owner.

## Alternatives considered

A default reader derived from the session would hide the authorization
and database binding from use cases again.

## Consequences

The session retains storage identity and transaction state. Asset reader
selection belongs to request or source assembly. Empty reference sets
require no reader calls.

## Verification

Tests exercise note and table reference retention, history replay, account
isolation, the compatibility site's community, and independent archive
import.
