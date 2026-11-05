# Agent Note: Model attempt decryptors and website writing assembly

Status: implemented

## Problem

Independent assistant rounds, visual reviews and Galgame transcription retained global key lookup.
Visual review accepted the entire application state container. The Thought application also held a
website adapter that directly connected model storage, provider streaming and call-log settlement.

## Decision

Each model attempt component receives its decrypt callable explicitly. Visual review now receives
only its session factory, configuration and decryptor. Models' writing protocol uses the entry-owned
decryptor. Test fixtures supply that capability directly rather than patching a global helper.

The compatible website's writing adapter moves to `assembly/website/thought_writing.py` and is
constructed with sessions, decryptor and provider transport resolver. Thought retains its existing
writing port; the cross-application SQL/provider connection is visibly an assembly responsibility.
The old module is removed without forwarding. The unused in-process `model_service/clients/text.py`
entry is also removed after checking imports and named consumers across source, tests and scripts.

## Alternatives considered

- Passing an application state container hides dependencies and makes adapter replacement brittle.
- Moving the global key lookup to another helper would retain the same implicit configuration.
- Keeping a forwarding module would preserve misleading ownership and stale import paths.

## Consequences

Model request scopes, attempt digests, encrypted formats, logs, cancellation and unknown-result
settlement remain unchanged. Real and fixture decryptors have identical call signatures. Remaining
legacy generation, playground, voice and workshop adapters still require their own migration.

## Verification

- Assistant round replay, visual/node reviews, submission recovery, Galgame ASR cancellation and
  writing account isolation/redaction/log settlement pass against isolated deterministic providers.
- Dependency gates reject removed paths and legacy credential imports in migrated components.
- OpenAPI, service ownership and all 23 source-closure entry imports remain checked.
