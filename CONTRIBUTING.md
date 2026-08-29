# 贡献指南

## 准备环境

项目要求 Node.js 24、npm 11 或更高版本、Python 3.11 或更高版本，以及 Git LFS。克隆仓库后先
运行 `git lfs install`；使用跳过 LFS 的检出方式时，再运行 `git lfs pull`。随后执行
`npm run setup`，复制 `backend/.env.example` 为 `backend/.env`，并生成新的 `FPL_SECRETS_KEY`。
不要提交 `.env`、真实供应商凭证或运行期素材。

使用 `npm run dev` 启动完整 Studio。后端固定监听 `127.0.0.1:9000`，Web 开发服务默认使用 3000 端口。首次启动会创建本机 SQLite 并自动执行已登记迁移。

## 代码与目录边界

新增代码前先阅读 `AGENTS.md` 和 `docs/architecture/project-layout.md`。后端按功能能力组织，路由只处理 HTTP/SSE 协议，不直接查询 ORM；不要增加通用 `services/`、`domain/`、`platform/` 或 `product/` 层。Web 保持 `app → features → shared/platform/generated` 的单向依赖，生成的 OpenAPI 文件不得手工编辑。

新增目录或改变职责时，必须同步更新项目结构文档与架构测试。生产 Python 单文件最多 700 行、
TS/TSX 最多 800 行、CSS 最多 600 行，测试文件最多 1,200 行；生成契约排除。历史超限文件记录在
`tests/architecture_size_baseline.json`，当前 production/tests 均为空且不得重新增加豁免。拆分必须按
用例、状态、展示或基础能力命名，不能新增编号式分片；测试同样按领域行为命名，不使用 `part-1`。

## 数据库与契约

schema 变更只能在 `db/migrations/versions/` 追加 migration 并登记到 `registry.py`。不得改写已登记 migration，也不得用脚本或数据库客户端直接写入持久数据库。运行期数据管理必须通过正式 `/v1` API 完成。

HTTP 或 SSE 形状改变时，同时更新后端 schema/路由、Web 消费端、API 文档与契约测试，然后运行 `npm run contracts:generate`。提交前必须运行 `npm run contracts:check`，保证生成物没有过期。

## 验证矩阵

- `npm test`：后端与 Web 单元/组件测试。
- `npm run lint`：Python 与 Web 静态检查。
- `npm run format:check`：格式门禁。
- `npm run contracts:check`：OpenAPI stale-check。
- `npm run build`：TypeScript、Vite 与 bundle 预算。
- `npm run test:e2e`：Chromium 端到端旅程，使用隔离数据库和确定性测试数据。
- `npm run lfs:check:pointers`：确认应由 LFS 管理的路径没有误提交完整二进制。
- `npm run lfs:check`：确认生产所需字体和 VAD 对象已下载且校验值正确。

涉及供应商的行为应使用确定性适配器测试；没有真实凭证时不得用付费调用代替自动化验证。

## 交付检查表

- 安装、启动、环境变量和目录变更已经同步到 README、配置文档及项目结构索引。
- migration、ORM、API、生成契约和测试保持一致。
- 没有提交 `.runtime/`、`output/`、`tmp/`、下载视频、密钥或本机缓存。
- 新增或替换二进制素材时已更新 `docs/assets/MANIFEST.md`，并通过 LFS 指针与对象检查。
- 上述六项质量命令全部通过；若有无法运行的外部验证，在交付说明中明确列出。
- 从全新检出目录按冻结锁文件安装后可以重复通过同一套命令。
- 生产部署说明、升级回滚步骤和开发交付已知债务已经同步更新。
