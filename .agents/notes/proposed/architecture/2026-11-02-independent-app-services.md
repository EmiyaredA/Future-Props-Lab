# Agent Note: Independently released applications with Compose and native Mac workers

Status: proposed

## Problem

The website owns all application routes, SQLite tables and task runners in one process. Updating the portal interrupts Agent indexing, browser login and every application. A second hostname or another copy of the complete backend retains those dependencies and risks conflicting data writers.

## Proposal

Keep one repository, a stable same-origin gateway and independent application releases. Each service owns its data, migrations, operations and runners. Identity owns existing accounts, sessions and API keys. Shared assets, models, rendering, integrations and native execution are explicit capabilities accessed through versioned interfaces.

Compose is the production entry point. Mac session collection, CLI/stdio/sandbox execution, MLX and host tools remain narrowly authorized native workers. They initiate authenticated connections to a loopback task ingress; containers do not receive personal home directories, native CLI credentials or the Docker socket. Portal updates do not restart Identity, Agents, Remote or the tunnel.

Current website runtime data is the sole authoritative source. Formal cutover is gated on exhaustive operation/table ownership, isolated migration and restore checks, complete service implementations and cross-application regressions. This worktree does not modify formal data or control the running website; independently authorized work in the primary checkout must be reconciled before cutover. Existing SQLite migrations are not rewritten and persistent records are changed only through formal business use cases.

## Alternatives considered

- Sharing the monolith database between processes leaves migrations and ownership coupled.
- Loading the entire backend in every container multiplies workers and exposes unrelated schemas.
- Containerizing macOS-only code loses native sessions, system permissions and Metal models.
- Online migration needs a long-lived dual-write protocol; the approved rollout uses a maintenance window.

## Acceptance criteria

All applications and capabilities have separate releases and data. Stop Portal while Agents synchronizes, Remote stays connected and fresh login succeeds. Restart each application independently. Preserve contracts, ownership, CAS, media exports, approvals and supplier submission recovery. Verify persistence, native worker reconnect, backup/restore and quality gates before opening formal writes. Restore matching code, configuration and runtime together if cutover validation fails.

## Risks

Service boundaries can preserve hidden database joins, stale authorization or duplicate supplier submissions if only entry points are separated. New runtime primitives and ownership manifests are preparation, not production readiness. Keep production on the archived monolith until every service has isolated business, storage, migration and restore coverage, including revocation of active streams and native worker receipts. Never copy the complete legacy database into each service.

## Implementation progress

Identity now has its own ASGI assembly, registered schema, SQLite lock, account creation outbox and minimal dependency-locked image. Public account operations reuse existing governance rules through explicit initialization callbacks; the legacy monolith retains catalog seeding. The gateway routes by the operation manifest, removes forged identity headers and asks Identity for request-bound assertions. Service authentication and live authorization primitives do not query another service's database.

Real isolated Compose checks exercise account login without Portal, independent restarts, duplicate-writer rejection, WAL, offline snapshot restore and logout. A disposable protocol probe checks header forwarding and listener authority; it is not an Agents implementation. All other business services, independent browser entries, native workers, event consumers and formal data import remain required before production cutover.


Agents now has an owned schema, source subscription coordinator, native job queue and independent image. The image contains neither Identity ORM nor native parsers. A separate Mac collector initiates authenticated loopback RPC, preserves one pending projection frame per source task and resumes from server checkpoints; frame acknowledgement and projection commit atomically. Read-only subscriptions are fenced by source revision, current subscription and live account permission. Generic unknown execution outcomes are never reassigned. Browser credentials are stripped before business proxying.

Real container acceptance now covers native fixture indexing, independent Agents replacement, continued incremental follow, fresh login with no Portal process, listener separation and owned SQLite integrity. Fresh-process tests cover lost acknowledgements, collector restart, duplicate frames, cross-account denial, attachment references and revoked streams. Independent browser bundles, remaining services, canonical deployment projections, production import and final cutover remain outstanding.


Gateway now has an independent control plane, owned notification cursors and deduplicated publisher receipts. Resource navigation delegates only registered read purposes from an active original request; Identity issues destination-bound assertions and revokes further delegation after logout. The Caddy process and control plane are one release. Mac public-access control, service-state aggregation and producer outboxes remain unfinished.

Agents now includes an independently built browser entry, embedded FPL login and versioned program resources. Packaging verifies file hashes and reachable public schemas; old program versions cannot write through that application's API, while other application versions and SDK clients retain their contracts. Real isolated Chromium acceptance covers history reading, themes, mobile/tablet/desktop, legacy redirects and source-form navigation. Unsaved protection coordinates multiple local guards and avoids duplicate native prompts after explicit approval. Native source allocation also rejects cross-account overlaps when the requested parser changes.


Assets now has isolated file/folder cases, an owned initial migration, CAS retention sets and immutable request receipts. Retention replacement and deletion serialize in the same SQLite database; cross-account IDs are absent, replay returns the original receipt without reverting newer sets, and a database foreign key guards retained assets. File deletion is scheduled in the deleting transaction and performed afterward by a recoverable per-file queue. Shared folder rules retain the legacy adapter. Assets HTTP assembly, image and browser are now connected; complete source-consumer recovery and controlled data transfer still block production cutover.


Portal now has an independent image and browser program, with no account/workshop ORM, runner or encryption key. Shared pure application metadata prevents the catalogue from importing workshop page registries. Existing reader and guide sources are reused; one generated SDK permission reference is updated in its own authorized commit; the owning release verifies and serves only listed screenshots. The developer-document operation retains its canonical ID, summary, tags and schema, with explicit browser-only permission registration. Four-container and Chromium acceptance passed for Portal replacement/stop and continued Agents login. Backend regression passed 1843 tests with 4 conditional skips; the unchanged-timeout Web suite passed all 1795 tests. The separately authorized management service, remaining applications and controlled migration still gate cutover.


The documentation guard now checks individual commits in CI: authorized product documentation must be isolated from code and Agent Notes. Working-tree protection remains strict, mixed commits fail, and merge commits are checked through their constituent history. This implements the existing separate-commit rule rather than granting permission to rewrite protected content; fixture repositories cover isolated, mixed and uncommitted changes.


Assets storage settings now reject foreign configuration groups and contain no encryption key. Existing file and folder archive use cases run with that minimal projection. Project ownership reads exchange a current original Assets request for a narrow Visual GET assertion; only five registered source operations can request it, host authority is removed, cookies are not forwarded, and logout revokes exchange. Target redirects, outages and unexpected success statuses are errors; only a real 404 means absent. Full Assets HTTP assembly and its reference/rendering ports remain required.


Reference preparation now has its own durable intent and pin table. A shared replacement set was insufficient when concurrent source writes saw the same source revision: one preparation could drop another's prospective asset. Prepare now retains independently; source data and its operation receipt commit atomically before confirmation. Newer confirmations supersede old protection while retaining later preparations, and unknown source outcomes never expire. Confirmed rollback, replay and permanent deletion have immutable outcomes. The new Assets migration preserves earlier files, pins, revisions and receipts. Visual's reference ORM moved to its owning feature; explicit legacy imports remain compatible, while a fresh Assets process and its static closure load no Visual ORM.

素材私有协议由 Identity 从原账号业务写请求签发单次修改授权，绑定调用服务、账号、请求 ID 和完整修改摘要。新准备复核有效账号和 Session/API Key，并在短事务取得锁后检查准备期限；已存在的准备回执可重放。确认和撤销只结算该意图，不取得文件读取或其他任务权限。注销后不能新准备，但已经接受的源修改仍能确认结果，避免恢复依赖浏览器常驻。源应用调用方的持久出站意图与回执接入尚待完成，不能据此开放正式多服务写入。

Assets now assembles the 22 existing file and placement operations and the private retention protocol, with an independent browser and image. Public schema hashing verifies unchanged paths, operation IDs, responses and CAS shapes. Heavy media transformations route to Rendering; host folder reveal routes to Tools. Project file placement belongs to Assets alongside folders, so removing a project folder removes placement links atomically while preserving library originals. The old Visual reference model remains a legacy compatibility/export source; transfer must preserve its IDs and revisions without importing it into the independent Visual service. New migration 0003 uses only owned foreign keys. Owned file layout upgrades verify copies and preserve originals; unknown commit outcomes preserve possibly committed bytes. Complete caller integration, formal transfer and container gates still block cutover.

The user explicitly reconfirmed independent databases after a parallel management task proposed shared SQLite. The management task has been informed: its UI and operations become another independent service, while Identity and Models keep their datasets. Management must use owned APIs and the restricted native lane; it cannot share-write the legacy database or mount Docker Socket. Production source also has new UI, retirement and management changes; this branch must reconcile the final stable source before any formal snapshot or cutover.

Real Assets browser acceptance caught a response middleware regression: private cache headers overwrote immutable program caching. Assets now forces no-store for business/private APIs and preserves the verified program loader's cache policy; the ASGI regression checks immutable JS, conditional 304, HTML revalidation, API privacy and missing resources. The full Web suite also exposed JSDOM's missing scrollIntoView API in deferred documentation navigation. The test environment models that standard browser API, without modifying protected documentation sources or test deadlines.

Visual review of real phone screenshots found stacked Chinese button labels despite no page overflow. The file toolbar now uses two columns with one-line labels and 44px targets on phones, one column on the narrowest screens. Browser acceptance checks actual text line rectangles as well as document overflow, themes and file functionality.


Stable primary website changes through `8f7b148b` are being integrated by source-preserving squash so protected documentation updates can remain in a standalone commit. This retains the new homepage, transfer feedback, responsive images, real file-content previews and authorized removal of mock model test tools. Registered historical migrations remain unchanged. Current-service program resources and generated image variants resolve beneath that service's immutable prefix, while private and foreign-service URLs remain untouched.

Rendering now assembles the five existing media read/derive operations without asset/workshop ORM. Source access delegates only the original account request for exactly the same asset's content, checks metadata revision/kind/length and enforces streamed input limits. Its own cache, input/output directories, configuration, lock, migration registry and image are isolated; authorization is checked again before returning results. Identity outages return 503 rather than falsely logging out the browser. Pure raster and PDF/media preview code is separated from account/database loading, so Identity avatar previews no longer import Assets. Durable timeline rendering jobs and app export handoffs still remain required.

Real six-container validation now includes synthetic video, audio, PDF, Chinese text, frame ZIP/grid output, Rendering replacement/stop and retained Assets reads. Assets multipart spooling uses its own data volume instead of the small container tmpfs; validation includes a 40 MiB upload and archive import. The archive upload adapter's argument shadowing has been corrected. These checks do not imply that unimplemented services or formal cutover are complete.

Runtime proxy errors may include custom assertion headers even when standard Cookie/Authorization redaction is active. Gateway's default Caddy logger now filters all request and response headers; actual container acceptance checks both normal errors and canceled streams for assertion disclosure. This affects logs only, not forwarded business identity.

The existing character-stage component test mixed initial placement inheritance with editing/restoring an existing scene and repeatedly exceeded its 10-second budget during the full suite. It now keeps both user journeys, starting the second from an explicit persisted scene; no assertions are removed and the timeout is unchanged. This also prevents a timed-out user-event chain from continuing after JSDOM teardown.

Models preparation replaces catalog scans of foreign workshop tables with an explicit task-occupancy port. Only the legacy website adapter reads its original same-database task tables; independent Models will provide its own execution records. Provider ownership is resolved before occupancy checks, and disabling a model now also refuses in-flight generation/transcription work. Missing write adapters fail closed. Models remains unassembled until all owned routes, jobs and host execution ports are implemented.

The Rendering batch passed the real six-service/Chromium run `fpl-isolated-agents-a14698a687`, full backend (1934 passed, 4 conditional skips), production build, contract/SDK, lint/format, official import seed, notes, protected-document commit isolation and LFS gates. After splitting the long character-stage journey, all 1825 Web tests in 283 files passed with unchanged timeouts and no unhandled errors. Models task-usage preparation adds 73 focused checks. Formal data is unchanged; remaining services still gate cutover.
