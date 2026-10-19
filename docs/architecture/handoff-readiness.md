# 开发交付说明

## 演示工坊段落列表

追加 `0099_presentation_lists`，为旧段落补齐 `numbered: false`，不改变原项目符号、revision 或更新时间。右侧面板与文字浮动栏支持无列表、圆点和编号；文字选区修改当前段落，整框修改全部段落。连续编号与软换行在保存、放映及 PPTX 中保持语义一致，空项回车退出列表。PPTX 使用可编辑原生列表，当前支持单层十进制编号。

## 演示工坊连接线层级

追加 `0098_presentation_connection_layers`，为旧文稿缺失的连接 `layer` 补 0，保留原绘制顺序、revision 与更新时间。连接面板支持置顶、置底和逐层移动，元素与连接共用顺序，保存、放映和 PPTX 同步。PPTX 中交错叠放的组按成员展开以保持遮挡，源文稿分组不变。迁移只在隔离测试数据中验证；正式桌面按既有停机备份与迁移流程升级，热加载不代办迁移。

## 演示工坊按页图像归档

追加 `0097_presentation_image_version`，为文稿页面中缺失的 `image_asset_id` 补 null，保留已有图像关联、顺序、revision 与更新时间。每页可从当前 Workspace 公共文件库选择或上传一张原始生成图，在页面面板预览、下载、更换或移除；归档独立于参考图，沿用文稿 CAS 与素材删除保护，不进入放映或 PPTX。迁移先在隔离数据库验证，正式桌面数据仍按停机备份与迁移流程升级，热加载不代办迁移。

## 演示工坊信息图与视觉重建

追加 `0096_presentation_scene`，将旧文稿确定性规范化为版本 2，补齐空分组、连接、来源记录及参考图字段，保留内容、顺序、坐标和 revision。信息图转换在浏览器执行，原生场景沿用文稿 CAS、批次回执、Workspace 素材校验及统一导出。ELK 在按需加载的独立 Worker 中计算布局，编译后的引擎单独限制在 1600 KiB，其余 JS 仍为 500 KiB；不改变正式数据启动与迁移流程。

## Seedance 官方视频

追加 `0095_volcengine_video`，扩展供应商、视频工坊任务与模型测试任务的供应商检查约束，保留执行信息、历史、索引和外键。Seedance 2.0 / 2.5 使用方舟原生异步任务，测试台、工坊与独立推理共用版本能力校验。参考视频复用临时上传服务；默认无需配置对象存储。真实数据升级按既有停机备份与迁移流程执行，不在桌面热加载时迁移。


## 视觉节点人工通过

追加 `r0094_visual_node_approval`，为旧画布节点补默认未通过标记，保留 revision、布局与输出历史。人工认可由节点 `approved` 保存，工作台、素材菜单、状态卡和画布共享；新结果或不同最终输出清除标记。无需新增数据库列，ORM 沿用节点 JSON。迁移只在隔离测试数据库完成验收，正式桌面更新沿用既有迁移预检流程。

## 视频生成执行状态

追加 `0093_generation_execution_info`，为共用任务驱动器的三个任务表保存可选执行信息。
ZEALMAN 队列、账本及任务身份匹配的实时事件归一化为阶段、排队位置、执行节点和采样步数。
前端紧凑显示并区分采样百分比与上游报告值；断线回退 HTTP，完成仍需结果保存。
新提交使用独立客户端身份，旧任务不抢占控制台连接。迁移已在隔离数据库验证；正式数据按停机备份与迁移 CLI 流程升级，桌面热加载不代办迁移。

## ZEALMAN 工坊视频生成与模型菜单

追加 `0092_visual_zealman_video`，视觉创作工坊通过现有项目素材、画布 CAS 和输出历史接入 U06、U17。
能力元数据驱动工作流参数与素材数量，提交中断不重提，恢复只查询原任务。图片和视频的底部模型菜单使用顶层 popover，根据窗口空间展开。迁移先经隔离数据库验证，正式桌面停机备份后通过迁移 CLI 应用。

## ZEALMAN 视频测试

追加 `0091_zealman_video`，模型服务支持 ZEALMAN 无密钥连接与 U17、U06 视频测试。
输入按参考顺序映射，未使用分支不引用远端示例；提交中断不自动重提，结果及时保存到当前空间。
迁移须先经隔离数据库验证，正式桌面升级须停机备份后执行，热更新不代办迁移。

## 多维表格人员、填色与编组

追加 `0090_thought_field_groups`，数据表增加编组 JSON，旧表默认为空列表。人员字段保存当前空间用户 ID，填色条件保存在视图配置。完整备份输出 version 9，继续读取 version 1–8。迁移先在隔离数据库验证；正式数据升级仍遵守停机备份与正式迁移入口，桌面热加载不执行迁移。

## 视觉工坊提示词版本

追加 `r0089_visual_prompt_versions`，将已有图像、视频与音频生成草稿归为提示词 v1，保留原文字、参数、布局、连线与 revision。每节点最多 20 个可编辑版本，版本切换仅改变文字；生成前等待画布 CAS 保存完成。旧客户端更新单份提示词时保留版本集合并更新当前版本，旧项目包导入同样归一化为 v1。迁移先在隔离数据库验证，正式数据升级遵守停机备份与正式迁移流程，桌面热加载不执行迁移。

## 外部连接与飞书文章同步

追加 `r0088_external_article_sync`，建立连接、绑定、任务、步骤与任务素材引用表。集成中心提供飞书自建应用凭据配置，思绪工坊文章提供绑定、预览和明确确认后的整篇手动同步；仅当前 Workspace 管理者使用。连接检查仅鉴权，目标另验编辑权限。任务按目标串行，追加正文和上传图片核验后移除旧正文；中断标记需要核对，重启不重放写入。飞书 revision 与 client_token 只作为观测版本及请求标识，不承诺远端 CAS 或跨请求原子替换。迁移和模拟服务验收在隔离数据库进行；真实飞书专用文档验收需另提供测试凭据。

## 视觉工坊看板与输出版本

追加 `r0086_visual_node_outputs` 与 `r0087_volcengine_images`。画布与看板共用节点、用途分类和输入引用；输出版本分页保留，上传、文本保存与成功生成自动成为最终输出。输入提交时解析并冻结具体版本，后台完成按最新画布短事务登记，不覆盖编辑内容。Seedream 4.5 使用方舟原生参考图数组，每次输出一张图片；同步结果通过共享任务驱动持久化。正式数据首次升级前须使用停机备份和迁移预检；迁移已在隔离数据库验证。

## 多维表格字段配置

追加 `0085_thought_field_config`，字段使用 JSON 保存日期和数字展示配置，旧字段默认空配置，记录原值与已有历史不改写。表头浮层与全表字段管理共用配置与转换预览。备份输出 version 8，继续读取 version 1–7 并归一化旧字段历史；新迁移先在隔离数据库验证，桌面开发更新仍遵守迁移检查和停机备份流程。

## 官方文档与普通笔记发布

追加 `0084_unified_official_publications`，保存库级官方标记、只读与角色编辑授权，以及导入来源映射和成功回执。已有发布保持非官方、非只读，新增发布默认只读。不自动导入、发布或修改正文。迁移仅在隔离数据库验收，正式数据须按桌面停机备份与迁移流程应用。

管理员在知识社区明确导入现有指南；导入包复用普通备份用例，105 份标准笔记包含 93 篇文章与 12 篇首页。构建和检查使用 `knowledge:seed:generate` 与 `knowledge:seed:check`，桌面后端携带 seed.json。旧 URL 只解析可访问官方发布，多匹配选择，无匹配提示。运行期阅读、编辑、历史与表格统一普通笔记机制，升级不覆盖导入内容。

## 多维表格

追加 `0083_thought_multitable`，旧文档 kind 默认为 note，知识库首页保持普通笔记。新增表、字段、视图、记录、差量历史和素材引用表，以及模板快照字段；不动态建 SQL 表，不改旧迁移。完整备份升级至 version 7，继续导入 version 1–6。迁移仅在隔离数据库验证，正式数据升级仍经停机备份与正式迁移入口，桌面热加载不执行迁移。

## 知识社区

知识社区追加 `0082_thought_publications`：新增发布记录、逐篇成员授权、用户收藏及编辑上传登记，正文继续保存在原知识库。迁移仅建表，不自动发布任何现有文章。迁移先在隔离数据库完成验证；正式数据停机备份后再通过正式迁移入口升级，开发热加载不执行正式迁移。

## 既有交付变更

桌宠轻伴随追加 `r0081_desktop_pet_presentation`：个人聊天保存气泡／对话展示偏好，已有会话保留对话模式，新会话默认气泡。热加载更新不得执行正式迁移；先完成隔离验证，停机备份并核验，再通过正式迁移入口升级。角色、消息和原有 revision 保留。

思绪工坊补齐能力追加 `0080_thought_knowledge_tools`：引用索引、共享模板及素材保护、不可变历史的命名标记、账号与 Workspace 隔离的筛选和阅读位置。正文 schema version 3 和画板 sceneVersion 2 保持旧版读取；完整备份升级至 version 6。

最新登记迁移为 `0083_thought_multitable`（多维表格与历史），此前 `0082_thought_publications`（发布与逐篇授权），此前 `r0080_thought_knowledge_tools`（思绪工坊引用、模板、命名快照和个人阅读状态）；此前的 `r0079_desktop_pet_chat` 按账号、Workspace 和桌宠隔离文字聊天设置、请求防重放与消息记录；`r0078_desktop_pet_whale` 支持本地导入鲸鱼娘固定快照；`r0077_desktop_pet` 建立 Workspace 桌宠项目与固定角色快照；`r0076_amadeus_workflows` 记录 Amadeus 模式、继续来源与持久提问；`r0075_creative_workshop` 记录创意工坊草稿、公开版本与安装记录；`r0074_live2d_editable_runtime` 和 `r0073_live2d_cubism_attachment` 扩展 Live2D 工坊。历史迁移仍按 registry 的既定顺序追加；升级细节见[账号治理](../reference/account-governance.md)。

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
3. 运行 `npm run setup`；复制 `backend/config.example.toml` 为 `backend/config.toml`，生成新的
   `security.secrets_key`；旧安装使用配置转换命令保留原密钥。供应商凭证仍在 App 中配置，
   真实密钥不得提交或写入日志、快照和文档。
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

后端只读取 `backend/config.toml`。变量说明、文件上限与备份范围见
[`配置参考`](../reference/configuration.md)，部署步骤见
[`生产部署`](../operations/production-deployment.md)。

本次本机验收使用 FFmpeg 8.1.2 / FFprobe 8.1.2，并确认 `libx264`、`aac` 与 `png` 编码器可见；这只是
已验证环境，不宣称未经测试的最低 FFmpeg 版本。接手机器可执行
`ffmpeg -version`、`ffprobe -version` 和
`ffmpeg -hide_banner -encoders | grep -E 'libx264|aac|png'` 检查同等能力。

## 迁移与兼容状态

- 当前 migration registry 最新版本为 `r0080_thought_knowledge_tools`；交接前通过
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
尺寸门禁没有豁免机制。测试过程未调用真实模型供应商。

标准质量命令：

```text
npm test
npm run lint
npm run format:check
npm run contracts:check
npm run build
npm run test:e2e
```

并行运行隔离浏览器验收时，为每次运行设置独立的 `FPL_E2E_DATABASE_PATH`、
`FPL_E2E_AUTH_STATE`、`FPL_E2E_OUTPUT` 和 API/Web 端口，避免共享登录快照覆盖。
代理保留的测试数据库、登录快照和截图统一放在已忽略的 `.local/` 任务目录中。

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
