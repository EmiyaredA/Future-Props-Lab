# Agent Note: Visual model catalog delegation

Status: implemented

## Problem

Generation options and acceptance model discovery in the compatibility application queried Models tables from the Visual feature. The independent Visual service needs the same model lists without access to provider credentials or Models storage.

## Decision

Models owns both filtered lookups and their credential-free output schema. Identity delegates only a matching Visual catalog request to its corresponding private Models path. Models verifies the target-bound token and checks the account with Identity before querying. Visual confirms project ownership before requesting acceptance models.

## Alternatives considered

Copying catalog rows into Visual would duplicate account data and enablement state. Reusing the full provider catalog response would transfer fields that these screens never display.

## Consequences

The published Visual URLs, operation IDs and model option shapes stay stable. A missing Models or Identity service returns a bounded availability error. Provider execution and result delivery retain their separate contracts.

## Verification

Signed integration coverage verifies both lookups, generation and vision capability filters, cross-account isolation, denied path substitution, browser ingress denial and revoked sessions. The compatibility Visual tests and image closure checks exercise both assemblies.
