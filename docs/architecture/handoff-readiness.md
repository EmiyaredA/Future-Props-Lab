# 开发交付说明

最新登记迁移为 `0058_presentation_media`，补齐整体透明度、翻转、矢量改色和图片边框缺省值；上一版 `0057_presentation_styles` 补齐元素样式缺省值。`0056_presentation_workshop` 追加演示文稿与图片引用表。上一版 `r0055_model_suppliers`，在已发布的运行时治理迁移后追加供应商分组，并保留三级身份、注册邀请码、角色模板与同步记录、敏感工具标记、官方作品和任务额度归属。升级细节见[账号治理](../reference/account-governance.md)。

账号治理迁移为 `r0050_workspace_governance`，追加在思绪工坊历史迁移之后。扩展固定成员角色并保存邀请目标角色，保留旧数据；升级影响见[账号与工作区治理](../reference/account-governance.md)。

文档编辑历史迁移为 `0049_thought_history`，在文档树迁移后追加不可变快照与历史附件引用；迁移测试使用临时数据库。

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

| 依赖             | 交付要求                                                | 用途与边界                                                |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Node.js / npm    | Node.js 24、npm 11+                                     | Web 构建、组件测试、工具脚本                              |
| Python           | 3.11+；CI 同时覆盖 3.11 与 3.14                         | FastAPI、任务执行器、迁移与后端测试                       |
| SQLite           | 应用内置驱动                                            | `.runtime/future-props.db` 是单机真源，不支持直接运维写入 |
| FFmpeg / FFprobe | 系统命令可用，并提供 H.264/libx264、AAC、PNG 编解码能力 | 视频导出、媒体探测；缺失时相关能力会明确失败              |
| Chromium         | 通过 Playwright 单独安装                                | 仅 E2E；当前不承诺其他浏览器的完整自动化旅程              |
| Git LFS          | 3.7.1+；克隆后执行 `git lfs install`                    | 管理文档图片、固定字体和 VAD 资产                         |
| 模型供应商       | 网络和有效凭证按功能选配                                | 确定性测试不调用真实供应商；交付方需另做凭证与配额验收    |

后端只读取 `backend/.env`。变量说明、文件上限与备份范围见
[`配置参考`](../reference/configuration.md)，部署步骤见
[`生产部署`](../operations/production-deployment.md)。

本次本机验收使用 FFmpeg 8.1.2 / FFprobe 8.1.2，并确认 `libx264`、`aac` 与 `png` 编码器可见；这只是
已验证环境，不宣称未经测试的最低 FFmpeg 版本。接手机器可执行
`ffmpeg -version`、`ffprobe -version` 和
`ffmpeg -hide_banner -encoders | grep -E 'libx264|aac|png'` 检查同等能力。

## 迁移与兼容状态

- 当前 migration registry 最新版本为 `0047_skill_tags`；交接前通过
  `npm run db:migrate:check` 只读确认目标数据库处于同一连续前缀。
- migration 只允许在 `db/migrations/versions/` 追加并登记，不得改写已登记版本、checksum 或
  `schema_migrations`。
- Story 当前写入版本为 1.4；1.0–1.3 仅保留读取兼容。运行期 Story 固化必须使用受鉴权的迁移 API，
  流程见 [`Story 1.4 迁移运维`](../operations/story-migrations.md)。
- `r0039_visual_generation_node_history` 为生成任务补充可空画布节点关联，回填画布当前任务并新增
  项目、节点和创建时间复合索引；REST 契约同步支持按节点查询图片、视频和音频生成历史。
- `r0041_visual_generation_batches` 新增 4/9 宫格图片生成批次和后台合成状态。
- `r0042_image_compositions` 扩展批次以持久化已有图片节点合成源和 caption 快照。

## 质量验收记录

2026-08-30 架构整改最终验收：357 个后端测试、457 个 Web 测试和 23 条完整 Chromium E2E 全部
通过。Python/Web lint、Python/Web format-check、OpenAPI stale-check、生产 Web build、r0038 数据库
迁移状态、LFS 指针/对象完整性以及文档资产数量与聚合摘要检查同时通过。
`architecture_size_baseline.json` 的 production/tests 均为空。测试过程未调用真实模型供应商。

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

## 最终架构结果

| 边界               | 整改后的 owner                                               | 稳定性约束                                                      |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
| HTTP 与租户        | `routes/` + `WorkspaceDep`                                   | 客户端不提交 Workspace；跨空间 ID 按不存在处理                  |
| 文件输入与落盘     | `files.IncomingFile` + `AssetStorage`                        | 业务不依赖 FastAPI；写路径必须显式 Workspace                    |
| 图片/视频后台任务  | `llm/generation_runtime/GenerationTaskDriver`                | 短事务状态转换；网络在事务外；提交中断不重提                    |
| 确定性媒体渲染     | `media_rendering/`                                           | Galgame 直接导出与视频剪辑共用契约；业务包不反向拥有渲染实现    |
| Workspace 项目原语 | `concurrency/project_records.py`                             | 显式租户谓词和 revision CAS；不提交事务、不承载领域默认值       |
| Story 1.4 校验     | `schemas/galgame_workshop/story_validation.py`               | 角色、素材、国际化、时间轴、流程、表现层纯函数分层              |
| Agent Harness      | `agents/harness/phases.py`                                   | 上下文、模型、提案、审批和执行阶段保持既有事件顺序              |
| 广播剧导入         | `annotation_import_runner.py` 的阶段方法                     | 预检、裁切、验收、落位、结算和补偿独立                          |
| Web 公共维护点     | 项目库控制器、feature query key、元数据 owner、Blob URL Hook | owner 外不复制项目生命周期、缓存键、能力映射或对象 URL 生命周期 |
| 源码尺寸           | 架构测试 + 空尺寸基线                                        | 生产与测试均无豁免，按语义拆分而非编号分片                      |

仍保留的兼容层只有明确的外部兼容：Story 1.0–1.3 读取/导入适配、默认 Workspace 的历史文件目录、
旧视觉生成任务中的 URL 参考字段，以及既有 REST/SSE/WebSocket 和 SQLite schema。它们没有成为新代码
的隐式默认路径；移除任何一项都应另立带数据迁移和契约变更的批次。

后续可选优化包括：在真实发布环境补做供应商凭证、配额、计费与临时媒体保留策略验收；为非 Chromium
浏览器增加媒体设备旅程；确认全部演示素材的再分发授权；如未来引入多实例，再单独设计外部队列、
PostgreSQL 和分布式任务认领。本次整改不提前引入这些范围。

下一阶段尺寸技术债仅登记、不在本轮机械拆分：后端
`schemas/galgame_workshop/blocks.py` 已到 700 行；Web 的 `files/AssetBrowser.tsx`、
`models/catalog/ModelServicePage.tsx`、Galgame 编辑器若干控制器和模型测试面板处于 780–796 行区间。
它们当前均通过硬上限且没有尺寸豁免；新增功能前应先按所属用例拆分，避免继续贴线上限增长。

## 演示数据与仓库素材边界

`docs/assets/` 的图片和演示媒体用于文档或可复现内容制作，不是运行期用户数据；来源、许可证状态、
内容集校验值和构建参与情况记录在 [`素材清单`](../assets/MANIFEST.md)。内容专用脚本已归入
`scripts/demo/galgame_runaway/`，生成的演示项目不是数据库种子；项目 ID、Workspace、素材根目录和
输入/输出路径都必须显式传入。Management API Key 只能通过短期进程环境变量传入。

当前分支的文档图片、固定字体和 VAD 运行资产已增量迁移到 Git LFS。迁移不改写既有历史，因此只能
阻止后续提交继续膨胀，不能立即减小既有 Git 历史；旧提交中的二进制对象仍会随完整历史传输。
交付声明统一为“仅限内部开发交接，未授予再分发许可”；仓库中存在文件或 LFS 对象不构成许可授予，
本轮也不新增或推定根许可证。

## 已知限制

- 仅支持单实例运行；SQLite、素材目录和后台任务状态必须作为同一个一致性单元备份与恢复。
- 自动化不验证真实供应商的可用区、配额、计费、内容审核或临时下载地址寿命。
- E2E 主门禁为 Chromium；各操作系统的媒体设备权限、音频输出和字体渲染仍需发布环境抽查。
- 未明确获得再分发授权的演示素材仍仅限内部演示和审阅；是否使用 LFS 不改变其许可状态。

## 回滚与恢复

本轮在现有未提交改动之上实施，没有执行提交、rebase 或历史改写，因此不能假设每项整改已经对应独立
Git 提交。交付方应先审阅差异并按自身发布流程形成可追踪变更。本轮没有 schema 变化；若应用尚未写入
新业务数据，可通过已审核的版本发布流程恢复上一代码版本。任何可能写入数据库、任务状态或素材的升级，开始前都应先停止应用，并同时
备份 SQLite 主文件以及 `workspaces/`、`profiles/`、`library/assets/`、`applications/`、
`model-test/attachments/`、`model-test/references/` 和 `model-test/generated/`。

需要数据回退时，必须在停机状态整体恢复同一时间点的数据库和全部运行期目录，再检查 migration、
`/ready` 和目标 Workspace。不得只恢复其中一部分，不得手工回写 SQLite、migration checksum 或
任务记录。详细步骤见 [`生产部署`](../operations/production-deployment.md) 和
[`故障排查`](../operations/troubleshooting.md)。

思绪工坊新增富文本笔记、图片引用与笔记本表，迁移仅创建 schema，不预置用户笔记。

思绪工坊迁移保留已落库的 ID `0044_thought_workshop`；迁移记录按插入顺序核对注册前缀，
不依赖 ID 字典序或秒级时间戳。迁移 SQL 与既有 checksum 不变。

附件扩展通过 `0045_thought_attachments` 升级笔记版本标记为 v2，保留正文与修订号；迁移已先在隔离数据库验证。v2 备份包含附件原始文件，兼容导入 v1。

知识库项目化通过 `0046_thought_knowledge_bases` 将旧笔记本迁为文件夹，保留文档身份与正文；v3 备份包含首页、封面、目录与文件。旧版本仅在导入转换层适配。
