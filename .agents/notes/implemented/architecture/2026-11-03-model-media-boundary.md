# Agent Note: Models-owned generation media and private output receipts

Status: implemented

## Problem

Models generation references, preview imports and result saving load Assets ORM or its filesystem paths. The old generation upload, backfill and result materialization paths can remove already committed bytes when an acknowledgement is lost. These dependencies and failure paths prevent an isolated Models service.

## Decision

Generation references and results stay in Models-owned storage. The recovery website explicitly installs `LegacyGenerationReferences`; only that adapter reads old Assets records. Independent Models does not install it, and rejects unmigrated historical references. Existing formal backfill APIs perform the conversion before transfer. Thumbnail consumers use the account-free bounded raster renderer.

Result delivery uses an explicit per-request `LibraryOutputs` port. The recovery website installs its original same-process use case; independent Models uploads bytes through purpose-bound Identity delegation. The source save operation and private target contain the same task ID. The target path binds filename, MIME, byte length and content SHA256; no account selector or storage path crosses the interface. Assets verifies the active original identity before and after streaming, then stores its own file and immutable result receipt in one short transaction. Concurrent retries or unknown responses resolve the same receipt instead of making duplicate files. Deleted copies produce an explicit conflict.

Private upload validation and file staging happen outside SQLite write transactions. The business use case validates the complete length and digest, rather than relying solely on HTTP parsing. Ordinary JSON retention requests retain their small body limit; output streams use bounded reads and the configured file limit. Cancellation cleans uncommitted files, while uncertain commits preserve potentially referenced bytes.

Native speech delivery uses the separate Models-owned lifecycle in `fpl_models/native_retention.py`. Only a persisted application or formal retirement decision permits removal of its delivery duplicate. Task deletion erases the native request payload/proof; original digests validate late receipts. Upload publication rechecks the durable fence, so deleted audio cannot be recreated. Request staging stays separate from artifact directories, and uncertain commits retain bytes until persisted state confirms cleanup. A separately saved Assets library copy retains its own lifecycle.

## Alternatives considered

- Mounting Assets data in Models violates per-service storage ownership and bypasses file permissions.
- A generic service credential that impersonates arbitrary accounts would exceed the original request.
- Sending the result while holding a Models or Assets writer blocks unrelated work on network waits.
- Treating every failed commit response as rollback can destroy a successfully saved result.
- Repeating an upload without a deterministic receipt can produce multiple copies after a lost response.

## Consequences

Public URLs and response shapes remain compatible. Independent saves deduplicate the same task result; the official testing guide explains verification and recovery. The private protocol is excluded from gateway discovery, public OpenAPI and SDK. Assets adds only its own `0004_model_output_receipts` migration, without changing registered history. Formal data remains untouched. Uncertain unreferenced files are retained for owned reconciliation; no timeout guesses the commit outcome. Complete service deployment, other application boundaries and formal transfer still require integration gates.

## Verification

The new regression coverage checks real Identity login, purpose-specific delegation, wrong service credentials, logout revocation, account-scoped receipts, exact Unicode names and bytes, content/length mismatches, oversized or compressed bodies, invalid authority, stream-time revocation, concurrent retries and unknown commit acknowledgements. A greater-than-two-MiB output bypasses JSON buffering and reaches owned disk. Fresh process imports of all generation and inference consumers load no Assets/account ORM or monolith database. Generation tests retain committed references/results after lost acknowledgements and remove precommit cancellation files. Existing Assets, retention, provider, generation, inference and thumbnail checks remain green. The 99-test native/model selection and 15-test migration/packaging selection pass. The rebuilt nine-container/browser batch fpl-isolated-agents-e308095503 passes 17 checks; the parent owns final full-suite acceptance. Real MLX weights/inference and formal transfer remain unverified.
