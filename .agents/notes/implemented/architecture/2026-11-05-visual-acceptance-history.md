# Agent Note: Preserve Visual acceptance decisions and evidence during migration

Status: implemented

## Problem

Standalone Visual needs historical acceptance templates, standards, versions, bindings, runs and repair drafts. Their evidence files remain owned by Assets, including references held only by a historic decision.

## Decision

Visual transfers each acceptance table through its own maintenance dataset and validates the project links among outputs, definitions, runs and repair drafts. A hexadecimal composite cursor preserves both parts of each legacy evidence reference without collision. A separate project projection rebuilds the evidence pins in Assets after the Canvas projection and SHA256-verified file receipts exist. Source export checks that previous runs and published versions still belong to the project. An owned project deletion releases its own acceptance and conversation pins, while other consumers continue protecting the originals.

## Alternatives considered

Copying only the latest acceptance result would omit earlier versions and the material used to reach them. Treating evidence references as Canvas references would discard them when a later Canvas save replaced its pin set.

## Consequences

Stored review revisions, outcomes and evidence identifiers survive transfer. Project deletion fences and settles the project-owned acceptance projection with the same durable Assets decision as the Canvas.

## Verification

The isolation rehearsal imports a historical review, its published definition, template, node binding, repair draft and two distinct references to the same evidence file. It checks both composite records and the rebuilt Assets projection, repeats transfer and reads the same evidence from the restored old website. The signed deletion regression checks that project evidence is removed while another service's original-file pin still prevents deletion.
