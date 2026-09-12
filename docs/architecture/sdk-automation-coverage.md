# SDK 自动化覆盖与验收

SDK 发行包为 `future-props-lab-sdk`，导入名为 `future_props_lab`，最低 Python 3.11。
本次不发布公共包仓库。Sayflow 仓库仅作为阅读布局的只读参考；研究所主题变量和品牌保持自有来源。

## 三层证据

- `sdk/python/operations.json` 固定 HTTP 操作与具名方法的对应关系。`coverage.json` 为每项操作提供公开文档和同步／异步 HTTP 契约测试位置。
- `sdk/python/workflows.json` 将六个工坊的实际创建、细粒度编辑、读取和导出流程映射到 API、SDK、可执行样例和测试。
- 下表记录行为测试范围。具名方法存在、返回 204 的模拟传输测试，均不能单独作为业务闭环通过的证据。

## 网页业务操作到自动化入口

除账号治理及实时语音外，Workspace 业务使用固定工作区 Management API Key 或 Session。
读取与文件导出需要 `content.read`，作品编辑需要 `content.write`，模型提交需要 `models.use`；
模型目录、集成和账号治理的细分权限以生成的逐操作参考与 `accounts/route_permissions.py` 为准。
Session 切换工作区必须显式执行；并发跨工作区使用不同客户端。

| 业务操作 | SDK 与 API 入口 | 文档与行为证据 |
| --- | --- | --- |
| 登录、改密、Session、二次验证、密钥与工作区治理 | `accounts`、`workspaces`、`admin`、`governance` 具名方法；沿用 `/v1/auth`、`/v1/account`、治理 API | `sdk-auth`；`test_python_sdk.py::test_sdk_session_login_reauth_and_workspace_key_isolation`；既有账号测试 |
| 模型、供应商、默认配置与调用日志 | `models`、`logs`、`templates`；现有目录与日志 API | 对应模块参考；既有模型、目录、治理测试 |
| 文件上传、目录、引用、下载、预览 | `files` 与各项目的素材方法；`/v1/files` | `sdk-files`；`test_python_sdk.py`；既有公共文件与素材引用测试 |
| 图片裁剪、视频帧与宫格导出 | `files.crop_file_image`、`files.extract_video_frames`；`/v1/files/{asset_id}/crop`、`frames` | `sdk-files`；`test_automation_exports.py`，验证像素、透明度、范围、原图保留、ZIP 与宫格 |
| 集成配置、校验与工具执行 | `integrations`、`test_tools`；现有集成 API | 对应模块参考；既有集成和模型工具测试 |
| 视觉节点增删改、位置、顺序、连线和生成草稿 | `visual.apply_canvas_operations`；`/canvas/operations` | `sdk-editing`、`sdk-workflow-examples`；`test_workshop_operations.py`、`test_sdk_workflows.py` |
| 视觉素材、生成与结果挂载 | `visual` 素材方法、`generation` 任务方法；复用已有生成入口和保存规则 | `sdk-reference-generation`；既有 visual generation、canvas、素材引用测试 |
| Galgame 角色、场景、Fragment、剧情块、对白、本地化、分支与表情时间 | `galgame.apply_story_operations`、既有局部编辑方法；`/story/operations` | `sdk-workshops`；`test_workshop_operations.py` 验证对白编辑、重复请求、角色引用保护；既有 Story 总校验与局部编辑测试 |
| Galgame 校验、恢复、项目包与视频导出 | `get_story_report`、`restore_story_snapshot`、`export_project_snapshot`、视频导出方法 | `sdk-workflow-examples`；`test_sdk_workflows.py` 与既有快照、视频导出测试 |
| 视频轨道、片段、裁剪、分割、变速、转场、关键帧与素材组织 | `video.apply_timeline_operations`；保留 `/timeline/operations` 及原请求字段 | `sdk-workflow-examples`；`test_sdk_workflows.py`、既有 `test_video_editor*.py` |
| 思绪目录、文档与内容块、范围文本、格式、附件 | `thought` 目录方法、`apply_note_operations`；`/notes/{note_id}/operations` | `sdk-workshops`；`test_automation_exports.py`、`test_sdk_workflows.py`；既有思绪测试 |
| 思绪写作、历史、Markdown 转换及导入导出 | `assistant`、历史方法、`convert_markdown`、`export_note_content`、`imports`、`backup` | `sdk-streams`、`sdk-files`；转换与保存范围冲突测试；既有历史、导入、写作测试 |
| 演示页面、元素、层级、位置、文字、样式、图片与裁剪 | `presentation.apply_presentation_operations`；`/projects/{project_id}/operations` | `sdk-editing`、`sdk-workflow-examples`；批次回滚、并发重放、锁定规则与既有图片裁剪测试 |
| 演示 PPTX 导出 | `presentation.export_pptx` | `test_sdk_workflows.py`；既有 presentation 导出、字体、裁剪、素材测试 |
| 标注说话人、片段、时间、情绪、原文翻译、拆分与合并 | `annotation.apply_annotation_operations`；`/document/operations` | `sdk-workshops`；`test_automation_exports.py`、`test_sdk_workflows.py`；既有标注文档测试 |
| 标注片段转写、音频裁切、JSON 与 SRT 导出 | `transcribe_saved_segment`、`download_segment_audio`、`export_annotation` | `sdk-files`；`test_automation_exports.py`，确定性 PCM 长度与内容校验 |
| 独立文本 JSON 与 SSE | `inference.generate_text`、`stream_text`；`/v1/model-inference/text` | `sdk-inference`、`sdk-streams`；`test_model_inference.py` 验证日志与供应商替身；SDK 类型化事件及断流清理测试 |
| 图片、视频、音乐、音效与语音识别任务 | `inference.create_task`、`get_task`、`list_tasks` | `sdk-inference`；`test_model_inference.py` 各模态替身、额度重放、输入认领、启停与中断恢复 |
| 独立任务下载、转存、删除与结果落盘重试 | `inference.download_result`、`save_result`、`delete_task`、`retry_materialization` | `sdk-files`；模型任务 API 测试及 `web/tests/inference-tasks.test.tsx` |
| 实时语音开始、PCM 收发、提交输入、打断、静音与停止 | `client.realtime()`；Session WebSocket `/v1/model-test/realtime` | `sdk-streams`；SDK 协议替身测试及既有实时语音测试。静音在客户端停止发送 PCM，不引入服务器未知指令 |

## 一致性与持久化规则

新增批次限一个资源，强制 revision，最终校验后一次 CAS、一次事务和一次 revision 更新。
持久回执按 Workspace、资源、request_id 隔离，内容不一致返回 409；项目删除清理所属回执。
思绪位置只在提交 revision 内有意义；嵌套对象更新要求提供该字段的完整合法值。

独立模型任务与私有输入直接持有 Workspace；文件位于对应 `workspaces/…/model-inference/`。
生成复用 `GenerationTaskDriver`；语音识别复用转写适配边界。提交中断安全失败，断流和重启均不自动再次调用供应商。
结果落盘重试只使用已保存的结果地址。等待超时仅结束 SDK 等待，仍可按任务 ID 查询。

`0059_project_operations` 与 `0060_model_inference` 在隔离数据库验证；本次验证没有启动真实数据库的自动迁移。
备份需在停机后包含整个 Workspace 目录及现有其他数据目录。结果输出转存公共文件库必须显式调用 API。

## 验收限制

六个工坊样例已覆盖最小完整流程，并使用网页所消费的 API 检查修改可见；这不等于所有细粒度操作组合都完成了浏览器端到端验证。
现有分项后端测试继续提供复杂编辑和导出规则的证据。真实供应商与硬件麦克风不属于本次确定性测试。
SDK 的所有具名方法有传输契约检查，但尚未逐一为全部治理、集成和工坊方法建立独立的完整业务样例。

文档浏览器测试覆盖桌面、深色、移动端、代码语言切换、键盘焦点与无横向溢出；内部文档保持原授权获取边界。
全量测试中的既有截图摘要、资产清单、文件尺寸和 Galgame 交互失败应单独跟踪，不以本次新增功能测试通过替代全仓门禁。

## 本次验证记录（2026-09-12）

- SDK／新功能专项：36 项通过，包含六个工坊的可执行样例、全部具名方法同步异步传输、Session 与密钥隔离、SSE 清理、批次与持久任务、媒体转换、提交中断后的输入文件保护。
- 全量后端：594 项通过、4 项失败、1 项跳过。失败为既有账号 CSS 越过应用壳边界、既有画布测试文件 1456 行、资产清单摘要不匹配、快照测试缺少既有 `grid_output`／`grid_size` 默认字段。
- 全量 Web：762 项通过、9 项失败；其中包含既有文档截图摘要不匹配和 Galgame 交互失败／超时。随后单独复核相关 Galgame 文件，30 项通过、4 项仍失败。新增任务面板 3 项通过，文档内容检查除既有截图摘要外通过。
- 文档浏览器旅程：1 项通过，包含桌面、深色、移动端、导航、键盘焦点及代码语言切换。
- `contracts:check`、`lint`、Python 格式检查、Web 生产构建、差异空白检查通过。全仓 `format:check` 仍被未修改的 `KnowledgeDocumentResults.tsx` 格式问题阻挡。
- wheel、源码包构建成功；独立虚拟环境安装并执行 `scripts/check_sdk_install.py` 通过。不依赖后端包，不调用真实供应商。

以上结果没有把全仓门禁标记为通过，也没有把最小流程扩展为全部业务组合的覆盖承诺。
