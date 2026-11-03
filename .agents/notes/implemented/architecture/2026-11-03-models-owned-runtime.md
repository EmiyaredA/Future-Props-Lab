# Agent Note: Models owns its HTTP, runners and governance lifecycle

Status: implemented

## Problem

Models has owned tables and authorization primitives but cannot run independently while provider imports load the global demo database, HTTP imports load console governance, and task runners do not use their owning execution authority. A separately assembled service can also pass operation-id checks while its page rejects a different complete API hash.

## Decision

`fpl_models/application.py` assembles the existing public model operations with its own database, provisioning consumer, templates, quota policy, deterministic demo runtime, original queued-task authority and native broker. `python -m fpl_models` performs explicit locked migration or serving; serving never migrates. It reads only its own data/configuration plus fixed Identity/Assets clients and a separate authenticated native lane. No Assets or Identity tables, old global database, workshop ORM or personal host directory is loaded. The provider HTTP adapters receive explicit transports; the recovery site supplies its legacy demo and asset adapters in assembly.

Each queued inference, generation and transcription claim obtains current Identity authority before taking its local writer lock. Terminal status, log and quota settlement share the local transaction. An unknown native submission keeps the original task/reservation; an uncertain result commit keeps the output bytes. Neither permits a new supplier or native submission. Native result reconciliation uses its original durable job and receipt.

Identity provides template target snapshots only under an original administrator operation, with current role/status and a five-second decision. Models reconciles each target catalogue in an explicitly owner-bound transaction and saves immutable operation receipts. Platform-target receipts are admin-only records; their target account IDs do not confer access to other private records.

HTTP model streams and real-time sockets revalidate their original accepted session, including a supplier that stops producing chunks. WebSocket routes have a separate fixed ownership inventory; a plain HTTP GET cannot become a socket or receive its assertion. Only the trusted gateway marks the real protocol, and API Keys cannot open browser-only real-time sessions.

Governance audit changes first prepare an inert Identity audit intent. JWT proof is verified in flight and is never saved in Models audit rows or Identity intent payloads. The local policy change and intent UUID/digest commit together; a post-commit runner settles that same intent. Unknown replies replay the immutable receipt. A rolled-back local change leaves an uncommitted inert intent. Template item audit events can only derive from a committed start intent; they do not grant task or account execution authority.

The independently assembled public API must equal the aggregate operation IDs **and** the full reachable schema/operation hash used by the browser build. This guards tags and response/schema differences that an operation-id comparison misses.

The Mac Models worker fences new dispatch with a thread-safe cancellation event, then waits for both the actual action teardown and its receipt thread before closing resources or releasing the host lock. A concurrent future becoming cancelled does not prove coroutine cleanup has finished. Pending or interrupted work remains unknown and is not dispatched again. Confirmed Models worker receipts clear their input payload on acknowledgement and startup, while preserving command digests and outcomes.

`InferenceRunner` receives an explicit `synthesis_scope` from `NativeModelBroker.foreground_synthesis`. It owns a task through submission, output copying, finish and exception handling. Its `finally` releases foreground ownership so the original durable receipt can recover a transient finish failure; the background path cannot finish concurrently. A lost finish reply is settled by reading the committed task.

Models appends `0012_native_result_retention`, adding `retired_at`, `artifacts_removed_at` and a retention index without changing earlier migrations. `native_retention.py` removes native delivery copies only behind persisted application decisions. Formal task deletion atomically retires the job, clears its payload and native proof assertion, and removes task authorization. Original payload/outcome digests plus worker/lease identifiers validate exact late receipts. Upload staging is separate in `.tmp/native-model-uploads`; its short final transaction rechecks the application fence before publishing. Applied uploads return the existing acknowledgement without recreating audio. Startup and polling retry confirmed cleanup; unapplied or uncertain jobs retain their bytes.

## Alternatives considered

- Reusing the old global demo/configuration database loads unrelated schemas and creates another writer to the monolith.
- Retaining full request assertions in audit rows adds credential-like secret retention; inert audit intents preserve recovery without that storage.
- Releasing quota or deleting output on every exception loses accepted work when only its response was lost.
- An autonomous service credential cannot select arbitrary account execution or template targets; the original user operation remains required.
- A successful HTTP-only composition cannot replace runner startup, full contract hashes or real gateway WebSocket acceptance.

- Cancelling only the caller or concurrent future can leave model cleanup running after lock release.
- Releasing ownership when native copying returns permits parallel finish paths; retaining it indefinitely prevents recovery.
- Removing delivery files before a durable decision risks losing recoverable output; unrestricted late uploads recreate deleted audio.

## Consequences

Models can be exercised as an independent service without exposing host credentials or cross-service databases. Native availability is reported from its explicit worker observation, rather than the Linux container platform. The current native container batch is accepted; remaining application services and controlled formal data export/import still require their own gates. Demo tool installation still belongs to Integrations; it must use that service's explicit interface instead of writing its tables. This note does not claim the overall multi-service cutover is complete.

## Verification

Independent Models tests cover deterministic model installation and text calls, private ownership, governance CAS and audit rollback, template target reconciliation, three actually wired runner revocation cases, silent-stream revocation/settlement, fresh-process import isolation, all owned runner startup/shutdown and equality with the browser build's complete contract hash. Real Identity HTTP scenarios cover management/studio purpose, socket handshake policy, Key denial, logout revocation and current template target checks.

The audit scenario uses two disposable owned databases: no JWT is present in stored intent payloads or Models audit columns, local rollback does not publish an audit, post-logout settlement works, a lost commit response is retried without duplication, derived template outcomes require a committed parent, and digest/actor injection or browser access is rejected. Native consumer outcome tests preserve uncertain submissions and committed output while cleaning confirmed failures. All test storage is temporary; no supplier or formal data is used.

The latest native lifecycle slice passes 99 targeted tests across transport, shutdown, result retention, inference, Models assembly, library output and local-model compatibility. Cases cover blocked download/serial execution, delayed cleanup and repeated stop, pre-dispatch cancellation, finish failures before commit and after a lost reply, concurrent upload/delete, late receipt/upload replay, cleanup failure and restart, confirmed versus uncommitted retirement, and acknowledged Mac receipt redaction. A separate 15-test migration/packaging selection passes; Ruff and formatting checks pass.

The rebuilt nine-container/browser batch `fpl-isolated-agents-e308095503` passes all 17 checks, including deterministic native installation, synthesis, library saving and independent restart, plus Integrations stdio and shared quota settlement. The focused failure tests establish the shutdown/retirement cases; the container batch establishes cross-service wiring. Formal data transfer, the remaining application services and real Qwen weights/MLX remain outside these results.

## Risks

Real Mac model installation/inference and the final container version set must be accepted separately; deterministic native-worker tests do not prove the installed weights or MLX environment. Existing unsigned local audit rows cannot invent an original authorization and are not automatically published as new intents. Formal import must preserve any existing historical audit records through the approved transfer use case.
