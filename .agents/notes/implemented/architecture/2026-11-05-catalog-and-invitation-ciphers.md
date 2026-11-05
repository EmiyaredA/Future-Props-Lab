# Agent Note: Catalogue and invitation credential adapters

Status: implemented

## Problem

Model catalogue writes, diagnostic reads, demo installation and invitation secrets still used
legacy helpers that constructed a cipher from global settings. Supplying an application instance
or replacing an adapter could silently select a different key. The old secret hint helper duplicated
behavior already owned by the explicitly configured runtime cipher.

## Decision

Catalogue consumers require a `CatalogCipher` with encrypt, decrypt and hint operations. Both
assemblies inject it into catalogue/default/supplier operations, diagnostic calls and demo installation.
The catalogue's CAS conflict snapshots use the same adapter as ordinary reads. Identity invitation
creation and reveal receive explicit encryption/decryption callables from their application instance.

`studio.runtime.secrets.SecretCipher` remains the production implementation and preserves Fernet
ciphertext and existing hint behavior. The unused `backend/app/runtime/secret_hints.py` is removed.
Architecture checks cover the migrated credential consumers and the single owner of hint logic.

## Alternatives considered

- Renaming the global helpers would retain hidden key selection and implicit configuration reads.
- Defaulting missing adapters to a global cipher would make misconfigured assemblies appear valid.
- Passing plaintext keys into business operations would expose implementation details unnecessarily.

## Consequences

Public schemas, account ownership, ciphertext, audit transactions and migration history are unchanged.
The supplied adapter can be replaced without changing the catalogue call sequence. Other model
execution paths still using the legacy decrypt helper remain separate migration work.

## Verification

- Real Fernet and an opaque memory-vault double execute the same create/read catalogue scenario,
  including component recreation, ciphertext round-trip and no plaintext in response snapshots.
- Account governance, invitation redemption and credential migration regressions use isolated data.
- Catalogue HTTP, demo service flow, Identity entry, dependency gates and service closure imports
  exercise the assembled implementations; provider diagnostics use deterministic local protocol stubs.
