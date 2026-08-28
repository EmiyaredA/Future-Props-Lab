# 开发交付说明

## 交付范围

Future Props Lab 是单机部署、单进程、单 SQLite 的模型基础设施管理台。同一进程内支持多账号和逻辑
Workspace 隔离，但不提供多实例部署、外置数据库、Bot、知识库、电话接入或浏览器扩展。目录职责以
[`project-layout.md`](project-layout.md) 为唯一完整索引，公共 HTTP/SSE 契约以生成 OpenAPI 和
[`API 参考`](../reference/api.md) 为准。

本说明记录可交付代码的环境、验证和数据边界。它不替代产品需求，也不授权绕过正式 `/v1` API 直接
修改持久数据库或运行期文件。

## 新开发者接手路径

1. 阅读根目录 `AGENTS.md`、[`README.md`](../../README.md)、
   [`CONTRIBUTING.md`](../../CONTRIBUTING.md) 和项目结构文档。
2. 准备 Node.js 24、npm 11+、Python 3.11+、FFmpeg 与 FFprobe。Playwright Chromium 仅为 E2E
   和开发验证依赖，不参与正式视频导出。
3. 运行 `npm run setup`；复制 `backend/.env.example` 为 `backend/.env`，生成新的
   `FPL_SECRETS_KEY`，按需填写供应商凭证。真实密钥不得提交或写入日志、快照和文档。
4. 运行 `npm run db:migrate:check`，确认本机数据库迁移状态；首次启动会自动应用已登记迁移。
5. 运行 `npm run dev`，检查 `/health`、`/ready`、登录和目标 Workspace。
6. 修改契约时同步更新后端 schema、OpenAPI 生成物、Web 消费端、API 参考和契约测试；修改目录职责时
   同步项目结构文档和架构测试。
7. 合并前按下方质量清单完成验证，并在交付记录中说明未执行项目及原因。

## 环境与外部依赖

| 依赖 | 交付要求 | 用途与边界 |
| --- | --- | --- |
| Node.js / npm | Node.js 24、npm 11+ | Web 构建、组件测试、工具脚本 |
| Python | 3.11+；CI 同时覆盖 3.11 与 3.14 | FastAPI、任务执行器、迁移与后端测试 |
| SQLite | 应用内置驱动 | `.runtime/future-props.db` 是单机真源，不支持直接运维写入 |
| FFmpeg / FFprobe | 系统命令可用 | 视频导出、媒体探测；缺失时相关能力会明确失败 |
| Chromium | 通过 Playwright 单独安装 | 仅 E2E；当前不承诺其他浏览器的完整自动化旅程 |
| 模型供应商 | 网络和有效凭证按功能选配 | 确定性测试不调用真实供应商；交付方需另做凭证与配额验收 |

后端只读取 `backend/.env`。变量说明、文件上限与备份范围见
[`配置参考`](../reference/configuration.md)，部署步骤见
[`生产部署`](../operations/production-deployment.md)。

## 迁移与兼容状态

- 2026-08-28 本地只读检查显示 SQLite schema 已到
  `r0036_galgame_video_editor_handoffs`，与当前 migration registry 一致。
- migration 只允许在 `db/migrations/versions/` 追加并登记，不得改写已登记版本、checksum 或
  `schema_migrations`。
- Story 当前写入版本为 1.4；1.0–1.3 仅保留读取兼容。运行期 Story 固化必须使用受鉴权的迁移 API，
  流程见 [`Story 1.4 迁移运维`](../operations/story-migrations.md)。
- 本轮质量门禁与文档修正不新增数据库 migration，也不改变 HTTP、SSE、WebSocket 或 SQLite 契约。

## 质量验收记录

2026-08-28 第一批整改已完成以下验收：323 个后端测试（含 26 个架构测试）、424 个 Web 测试、
22 条完整 Chromium E2E 全部通过；录音标注用例另以 3 个 worker 并行重复三轮通过，未增加测试超时。
Python/Web lint、Python/Web format-check、OpenAPI stale-check 和生产 Web build 同时通过。测试过程未
调用真实模型供应商。

标准质量命令：

```text
npm test
npm run lint
npm run format:check
npm run contracts:check
npm run build
npm run test:e2e
```

缺少真实供应商凭证时，不执行会产生费用或依赖外网状态的真实模型调用；应明确记录未验证的供应商、
模型和原因，不能用真实调用替代确定性测试。

## 演示数据与仓库素材边界

`docs/assets/` 的图片、字体和演示媒体用于文档或可复现内容制作，不是运行期用户数据。内容专用脚本
生成的演示项目也不是数据库种子，不能假定其项目 ID、Workspace、素材根目录或本机路径在其他环境
存在。Management API Key 只能通过短期进程环境变量传入。

当前仓库历史含较大的演示二进制素材。Git LFS 的增量迁移将在独立批次完成，不改写历史，因此只能
阻止当前分支及后续提交继续膨胀，不能立即减小既有 Git 历史。迁移完成前，普通 Git clone 仍会下载
历史对象。

## 已知限制

- 仅支持单实例运行；SQLite、素材目录和后台任务状态必须作为同一个一致性单元备份与恢复。
- 自动化不验证真实供应商的可用区、配额、计费、内容审核或临时下载地址寿命。
- E2E 主门禁为 Chromium；各操作系统的媒体设备权限、音频输出和字体渲染仍需发布环境抽查。
- 演示素材的来源、许可证、校验值和生产构建参与情况将在素材清单中逐项登记；未登记素材不能视为
  可再分发资产。

## 回滚与恢复

纯代码批次可回退对应提交并重新执行质量门禁。本批没有 schema 变化；若应用尚未写入新业务数据，
可直接恢复上一代码版本。任何可能写入数据库、任务状态或素材的升级，开始前都应先停止应用，并同时
备份 SQLite 主文件以及 `workspaces/`、`profiles/`、`library/assets/`、`applications/`、
`model-test/attachments/`、`model-test/references/` 和 `model-test/generated/`。

需要数据回退时，必须在停机状态整体恢复同一时间点的数据库和全部运行期目录，再检查 migration、
`/ready` 和目标 Workspace。不得只恢复其中一部分，不得手工回写 SQLite、migration checksum 或
任务记录。详细步骤见 [`生产部署`](../operations/production-deployment.md) 和
[`故障排查`](../operations/troubleshooting.md)。
