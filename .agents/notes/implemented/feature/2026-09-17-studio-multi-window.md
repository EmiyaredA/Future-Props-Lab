# Agent Note: 同工作区多 Studio 窗口

Status: implemented

## Problem

桌面 App 被单实例锁与主窗 hide 语义锁成单业务窗：再开 App 只聚焦现有窗，关闭是隐藏而非再开，
用户无法在同工作区并行打开多个页面或对照同一项目。

## Decision

保持单 Electron 进程、单后端、`persist:studio` 共享登录与单一 Session `active_workspace_id`。
主进程维护 Studio 窗口集合：菜单「新建窗口」/`CmdOrCtrl+N` 再开业务窗；非末窗关闭销毁，末窗
关闭仍 hide；退出向所有 Studio 窗收集未保存批准后再关窗停后端。同资源并发继续走
`expected_revision` / 409；保存成功后经 `BroadcastChannel` 失效其他窗的 TanStack Query 缓存，
不跨窗同步未保存草稿。

## Alternatives considered

- **允许多个 App 进程 / 多后端** — 与 `backend.lock` 和单机 SQLite 真源冲突，拒绝。
- **每窗独立工作区或独立 Session** — 可跨空间并行，但要改租户模型与切换广播；当前需求是同工作区对照，拒绝。
- **OT/CRDT 实时合并多窗草稿** — 复杂度远高于对照编辑，拒绝。

## Consequences

- **收益**：可多窗并行或同项目对照，且不拆数据目录与后端。
- **代价与已知上限**：切工作区仍全窗刷新；一窗未完成退出确认时需再次 `Cmd+Q` 重试；Visual canvas 等未接线的保存路径暂只靠 409。入口在 App 顶栏「新建窗口」（见 [desktop-chrome-in-app-header](2026-09-17-desktop-chrome-in-app-header.md)）；画布全屏页另有顶栏入口（见 [visual-canvas-new-window](2026-09-17-visual-canvas-new-window.md)）。

## Verification

- 菜单新建第二窗；关非末窗后端仍在；关末窗 hide；`Cmd+Q` 多窗未保存可取消。
- 两窗打开同一笔记/演示/音频/Galgame 故事，一窗保存后另一窗缓存失效或保存得 409。
- `npm run verify-notes`；相关 web 组件测试与桌面文档描述一致。
