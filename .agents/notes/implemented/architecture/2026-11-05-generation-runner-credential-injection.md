# Agent Note: Generation runner credential injection

Status: implemented

## Problem

Generation, transcription and workshop adapters resolved provider keys through the old process-global
credentials module. Three Models runners also silently selected global settings when assembly omitted
configuration, preventing reliable component replacement and isolated application construction.

## Decision

GenerationTaskStore, transcription runners and workshop model adapters require an explicit decryptor.
Both website and independent service assembly select the key. Models inference, generation playground
and transcription playground runners require explicit settings. The old app/runtime source package is
removed, with a production-wide architecture gate against reintroducing its imports.

The account-bound claim still precedes credential use. GenerationTaskDriver remains the sole task
state arbiter; cancellation, unknown submissions, recovery and terminal settlement rules are unchanged.
Test fixture encryption lives only in tests/credential_test_support.py, using conftest's isolated key.

## Alternatives considered

- Moving a global credential getter into Studio would retain the implicit dependency.
- Optional decryptors would hide missing assembly and select an unintended process key.
- A production compatibility shim would perpetuate the obsolete runtime namespace.

## Consequences

Ciphertext, persistent records and public contracts remain compatible. Callers constructing runners
must supply both configuration and credentials. Existing broader runner dependencies and cross-app
storage access require subsequent batches; this change does not claim to finish their decomposition.

## Verification

Targeted isolated regression covers Models and workshop generation, transcription, account binding,
authority revocation, native outcomes, cancellation and recovery. Architecture checks prohibit old
runtime imports and global configuration fallback in the three Models runners. Source-closure entry,
OpenAPI and service ownership checks supplement regression; they do not substitute for image builds.
