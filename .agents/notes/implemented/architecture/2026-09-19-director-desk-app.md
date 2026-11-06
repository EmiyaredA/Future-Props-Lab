# Agent Note: 导演台作为独立 App 迁入

Status: implemented

## Problem

导演台是三维预演工具，场景语义依赖已加载的 WebGL。若把工程 JSON、二进制和改场景工具拆进现有视频剪辑、Galgame 或视觉工坊，文档模型和运行时都会错位。外部的 Codex / Claude Code 需要操作这个 App，但不能另起一套 MCP，也不能在服务端改尚未加载的场景。

## Decision

导演台是 App `director-desk`。编辑器进程是场景的唯一写入方；服务端只保存它校验后的瘦 JSON，并用 CAS 拒绝过期写入。模型、贴图和视频以 SHA-256 放在 `applications/director-desk/projects/{id}/files/`，不进入 SQLite，也不给共享 `VisualAsset` 增加外键。用户动作库元数据在 `director_desk_user_motions`，模型包在 `applications/director-desk/library/`。编辑器内存仍使用内嵌字节，只在保存和打开时转换。`.director` 的打包和解包在浏览器完成。

不建编辑器内助手，不调用模型回合，不建助手会话表，不移植导演台自己的 Electron 与 MCP。外部 Agent 只用 `fpl` 和 Python SDK。项目、文件和动作库走已有 HTTP。改场景、查询几何和导出只在该工程的编辑器已打开时，经进程内会话把一次工具调用交给 `toolService`；未打开则拒绝，不排队、不落库。等待结果期间不保持数据库写事务。同一项目只保留最后一次打开的编辑器。

## Alternatives considered

- **先做编辑器内助手，再登记同一套 `fpl` 命令** — 对话能贴着画面走，但用户要接的是外部 Codex / Claude Code，内置模型回合会变成第二套入口。
- **把场景 JSON 的 `patch_project` 当作 Agent 的编辑接口** — 能复用 CAS，但服务端不采样几何，`director_apply` 的校验和撤销都在 WebGL 里。
- **移植导演台 MCP** — 工具面现成，但本机 Agent 通道明确不提供第二套 MCP，账号和密钥也不能从那条通道出去。
- **把模型字节放进共享 VisualAsset** — 能复用现有上传，但要给共享表加第四个互斥外键；导演台资源不是图库素材。
- **把三维场景映射进视频剪辑时间轴或 Galgame Story** — 能复用现有项目壳，但两边的时间、镜头和素材都不是同一份数据。

## Consequences

- **收益**：外部 Agent 用仓库里的 CLI、SDK 和 skill 操作导演台；场景工具不会在没有画面的进程里假装执行。
- **代价与已知上限**：编辑器必须保持打开。关掉页面后进行中的调用失败。进程内会话不跨进程，桌面单实例足够。只读授权不能改场景、导出或取消任务。原来的助手面板、讨论模式和本机 MCP 连接界面已删除；场景工具仍只由 `toolService` 执行。

## Verification

`uv run pytest -q tests/test_director_desk_projects.py tests/test_director_desk_agent.py tests/apps/visual_workshop/test_workspace_governance.py::test_every_business_operation_has_an_explicit_policy`；`npm run contracts:check`；`python3 skills/future-props-lab-automation/scripts/validate_skills.py`。
