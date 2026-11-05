# Agent Note: Visual generation model boundary

Status: implemented

## Problem

Visual provider validation and request assembly lived with the compatible Visual database and its asset paths. Models needs the same provider rules when executing independent requests, while Visual needs the model display identity and provider capabilities.

## Decision

Move model eligibility, provider parameter validation and request assembly to the existing LLM capability. The compatible site binds explicit media callbacks to those functions. Independent Models issues a credential-free selection response after an exact Identity grant and an owner-bound model lookup. It retains provider credentials and its upload configuration values. Assets serves exact project and task metadata and framed originals under a separate Models-use grant. The signed target binds each requested revision and identifies the owning project.

## Alternatives considered

Duplicating provider-specific parameters in the independent service would cause existing workflows and accepted input types to diverge. Moving all Visual history and Canvas rules to Models would transfer business ownership across the boundary.

## Consequences

The compatible site's provider behavior and public schemas remain in place. The new Models lookup is private. Independent task admission, durable original staging in Models and result settlement are separate work.

## Verification

Focused regressions cover queue and provider behavior, including Zealman, model selection without credentials, changed digest denial, foreign-account denial, architecture and image dependency boundaries. The private Assets tests read exact original bytes and reject stale revisions, modified digest bodies and cross-project grants.
