# Agent Note: Coopanion 鲸鱼娘本地快照导入

Status: implemented

## Problem

Coopanion 的 DeepSeek 大肥鱼使用独立的分件 WebGL 动画，不能作为 Cubism 或当前 Live2D 工程直接导入。其二创角色与厂商标志也不应未经核权随正式应用分发。

## Decision

桌宠项目新增 `coopanion-whale` 来源类型。开发者显式从本地 Coopanion 目录打包纯数据 ZIP，应用经 Workspace API 严格校验路径、清单、模型引用与 PNG 后复制固定快照；上传脚本不会执行。原版 MIT 动画代码保留在桌宠功能内部，并附许可说明；运行时只从鉴权 API 读取当前项目贴图。编辑器与桌面窗口共用适配器，八套配色使用 `schemeId` 保存，事件 ID 按鲸鱼娘的动作和表情表校验。

新增迁移 `r0078_desktop_pet_whale` 将现有 Live2D 行保留为 `live2d` 来源，鲸鱼娘行独立保存模型与素材映射。整体配置继续以 revision CAS 保存。鲸鱼娘资源不能通过 Live2D 的来源更新或逐部件皮肤接口修改。

## Alternatives considered

- **转换为原生 Live2D 工程**：会丢失原有物理动态与表情效果，因此保留其原版动画运行时。
- **把美术资源随应用打包**：存在二创与商标再分发问题，因此仅在本地显式导入隔离数据。

## Consequences

- **收益**：鲸鱼娘保留原版分件动画和八套配色，导入后不依赖 Coopanion 目录，且按 Workspace 隔离。
- **代价与上限**：新增来源类型和数据迁移；鲸鱼娘不能在 Live2D 工坊编辑，正式公开分发前仍需核清素材授权。

## Verification

在临时数据库测试迁移、ZIP 校验、Workspace 隔离、CAS 与无效引用；通过隔离 Electron 数据测试导入、八套配色、保存重开和真实窗口清理。正式数据不参与自动测试。
