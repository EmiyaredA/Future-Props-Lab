# Agent Note: Independently released applications with Compose and native Mac workers

Status: proposed

## Problem

The website owns all application routes, SQLite tables and task runners in one process. Updating the portal interrupts Agent indexing, browser login and every application. A second hostname or another copy of the complete backend retains those dependencies and risks conflicting data writers.

## Proposal

Keep one repository, a stable same-origin gateway and independent application releases. Each service owns its data, migrations, operations and runners. Identity owns existing accounts, sessions and API keys. Shared assets, models, rendering, integrations and native execution are explicit capabilities accessed through versioned interfaces.

Compose is the production entry point. Mac session collection, CLI/stdio/sandbox execution, MLX and host tools remain narrowly authorized native workers. They initiate authenticated connections to a loopback task ingress; containers do not receive personal home directories, native CLI credentials or the Docker socket. Portal updates do not restart Identity, Agents, Remote or the tunnel.

Current website runtime data is the sole authoritative source. Formal cutover is gated on exhaustive operation/table ownership, isolated migration and restore checks, complete service implementations and cross-application regressions. The running monolith remains unchanged until those gates pass. Existing SQLite migrations are not rewritten and persistent records are changed only through formal business use cases.

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


Assets now has isolated file/folder cases, an owned initial migration, CAS retention sets and immutable request receipts. Retention replacement and deletion serialize in the same SQLite database; cross-account IDs are absent, replay returns the original receipt without reverting newer sets, and a database foreign key guards retained assets. File deletion is scheduled in the deleting transaction and performed afterward by a recoverable per-file queue. Shared folder rules retain the legacy adapter. Assets HTTP assembly, authorized reference consumers, project-reference ports and its image remain unfinished and block production cutover.


Portal now has an independent image and browser program, with no account/workshop ORM, runner or encryption key. Shared pure application metadata prevents the catalogue from importing workshop page registries. Existing reader and guide sources are reused; one generated SDK permission reference is updated in its own authorized commit; the owning release verifies and serves only listed screenshots. The developer-document operation retains its canonical ID, summary, tags and schema, with explicit browser-only permission registration. Four-container and Chromium acceptance passed for Portal replacement/stop and continued Agents login. Backend regression passed 1843 tests with 4 conditional skips; the unchanged-timeout Web suite passed all 1795 tests. Identity's standalone management page and remaining services still gate cutover.


The documentation guard now checks individual commits in CI: authorized product documentation must be isolated from code and Agent Notes. Working-tree protection remains strict, mixed commits fail, and merge commits are checked through their constituent history. This implements the existing separate-commit rule rather than granting permission to rewrite protected content; fixture repositories cover isolated, mixed and uncommitted changes.


Assets storage settings now reject foreign configuration groups and contain no encryption key. Existing file and folder archive use cases run with that minimal projection. Project ownership reads exchange a current original Assets request for a narrow Visual GET assertion; only five registered source operations can request it, host authority is removed, cookies are not forwarded, and logout revokes exchange. Target redirects, outages and unexpected success statuses are errors; only a real 404 means absent. Full Assets HTTP assembly and its reference/rendering ports remain required.


Reference preparation now has its own durable intent and pin table. A shared replacement set was insufficient when concurrent source writes saw the same source revision: one preparation could drop another's prospective asset. Prepare now retains independently; source data and its operation receipt commit atomically before confirmation. Newer confirmations supersede old protection while retaining later preparations, and unknown source outcomes never expire. Confirmed rollback, replay and permanent deletion have immutable outcomes. The new Assets migration preserves earlier files, pins, revisions and receipts. Visual's reference ORM moved to its owning feature; explicit legacy imports remain compatible, while a fresh Assets process and its static closure load no Visual ORM.

素材私有协议由 Identity 从原账号业务写请求签发单次修改授权，绑定调用服务、账号、请求 ID 和完整修改摘要。新准备复核有效账号和 Session/API Key，并在短事务取得锁后检查准备期限；已存在的准备回执可重放。确认和撤销只结算该意图，不取得文件读取或其他任务权限。注销后不能新准备，但已经接受的源修改仍能确认结果，避免恢复依赖浏览器常驻。源应用调用方的持久出站意图与回执接入尚待完成，不能据此开放正式多服务写入。
