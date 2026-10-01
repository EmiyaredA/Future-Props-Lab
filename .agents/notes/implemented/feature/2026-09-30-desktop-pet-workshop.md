# Agent Note: 桌宠工坊的固定角色快照与受限桌面运行

Status: implemented

## Problem

桌宠需要复用已保存的 Live2D 角色，同时允许独立配置皮肤、反应和行为。直接引用可变的来源项目会让来源编辑或删除破坏运行中的桌宠；透明桌面窗口也需要独立的输入边界与生命周期。

## Decision

桌宠项目属于当前 Workspace，创建时经 Live2D 工坊的只读公开入口复制角色文档和必需素材。来源更新只能显式触发，先验证动作、表情和皮肤尺寸，再以项目 revision CAS 提交。皮肤以来源部件素材 ID 指定等尺寸 PNG 替换，交互与习惯保存在同一版本化配置中。

Electron 只允许受信 Studio 页面启动或关闭单只桌宠。独立 `pet.html` 使用相同会话分区读取桌宠快照，仅桌宠页面可调整点击穿透和位置，位置被限制在多屏可用区域。身份或 Workspace 变化、应用退出时关闭窗口；运行时换肤与走动设置仅保留在当前会话。

## Alternatives considered

- **直接引用 Live2D 工程** — 减少素材副本，但来源改动和删除会让桌宠无法重现，故使用固定快照。
- **将桌宠并入 Live2D 编辑器** — 共享 UI 更直接，但角色制作和桌面行为配置的生命周期不同，故使用独立工坊并复用渲染能力。

## Consequences

- **收益**：项目和素材按 Workspace 隔离，桌宠在来源删除后仍可读取；桌面窗口具有限定 IPC 与手动生命周期。
- **代价与已知上限**：快照占用额外磁盘；首版只支持当前 macOS 桌面版的一只桌宠，音效为内置提示音，公开发布与桌宠包尚未提供。

## Verification

运行 `UV_CACHE_DIR=.local/desktop-pet/uv-cache uv run --offline pytest -q tests/test_desktop_pet.py tests/test_sqlite_storage.py`，以及 `npm run test --workspace desktop`、Web 类型与路由检查。迁移只在隔离测试数据库验证。
