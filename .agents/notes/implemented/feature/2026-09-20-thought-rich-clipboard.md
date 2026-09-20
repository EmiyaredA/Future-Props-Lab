# Agent Note: 思绪工坊富文本剪贴板与图片迁移

Status: implemented

## Problem

思绪工坊的图片节点只保存素材 `assetId`。原有块复制路径只写入 HTML 和纯文本，编辑器的 HTML 清洗又会删除所有 `img` 与 `data-*` 属性，因此从一篇文档复制到另一篇文档时，正文可以保留而图片会静默丢失。仅传递 `assetId` 也不能安全支持不同知识库之间的复制，因为素材作用域可能不同。

首轮实现曾把自定义 MIME 写成裸的 `application/vnd.future-props-lab.thought+json`，并在 paste 事件里用 `clipboardData.getData` 读取。Chromium/Electron 要求自定义类型使用 `web ` 前缀，且只能通过 `navigator.clipboard.read()` 读取；非法 type 还会导致整次 `clipboard.write` 失败。复制 handler 又会 `preventDefault`，于是跨知识库 Ctrl+A 复制后常出现「正文还在、图片被 HTML 清洗静默删掉」。

## Decision

思绪工坊使用版本化的应用内剪贴板格式 `application/vnd.future-props-lab.thought+json`。写入 `ClipboardItem` 时键名必须是 Chromium 要求的 `web application/vnd.future-props-lab.thought+json`；Blob 的 `type` 仍用真实 MIME。粘贴时按 `clipboard.read()` → 同会话内存载荷 → HTML 迁移 → 默认清洗 的顺序处理；**不要**依赖 paste 事件的 `getData(自定义类型)`。

复制时同时写入 ProseMirror 片段、源知识库作用域、图片节点属性和图片二进制的 base64 数据，并继续写入 `text/html` 与 `text/plain` 作为普通编辑器兼容层。序列化成功后额外保留一份同会话内存载荷，覆盖「同窗口跨知识库」主路径，避免系统剪贴板清洗或权限抖动。若带自定义 type 的 write 被浏览器拒绝，降级为只写带内联图的 HTML/纯文本，并仍保留内存载荷。块菜单复制和编辑器原生 Cmd/Ctrl+C 共用同一序列化实现。

源、目标知识库相同时复用 `assetId`；作用域不同时，先通过现有图片上传接口完成全部素材迁移，再一次性插入重写后的片段。迁移上传的 `File` 必须带后端允许的扩展名（`.png` / `.jpg` / `.gif` / `.webp`）：图片 `alt` 或「粘贴图片」这类无后缀名会被 `AssetLibrary` 判为「不支持此文件类型」，因此序列化与上传前会按 MIME（必要时嗅探魔数）补全扩展名。任意素材迁移失败都不会插入半截内容。应用格式不可用时，HTML 回退只保留经过校验的思绪工坊托管图片；带来源作用域、来源未知、或浏览器剥掉 `data-asset-id` 但仍留在 `figure[data-thought-image]` 且含合法内联 `data:` 的图片，都会先迁移再插入。托管图片若没有可迁移数据则直接报错，不插入残缺正文。普通外部图片和未知 `data-*` 属性仍会被拒绝，不自动下载网页资源。外部粘贴若不再带托管标记，会丢弃过期的会话载荷，避免误贴上一次复制内容。

协议和序列化逻辑集中在 [clipboard.ts](../../../web/src/features/thought-workshop/clipboard.ts)，编辑器只负责事件接入和错误展示；素材作用域由当前笔记的知识库 ID 提供。实现沿用现有 `/v1/thought-workshop/images` 和文件内容读取能力，没有增加后端接口、数据库迁移或素材表字段。

## Alternatives considered

- 只复制 HTML、纯文本和 `assetId`：实现成本最低，但跨知识库时会留下无法访问的源素材引用，且现有 HTML 清洗会继续丢失图片，因此不满足迁移和安全边界。
- 复制时保留外部图片 URL，或在粘贴时无条件下载 `<img>`：能够让更多网页看起来“复制成功”，但会引入跟踪像素、任意远程资源和来源授权风险；回退路径必须拒绝外部图片。
- 新增后端“复制素材/复制片段”接口：可以把二进制迁移放到服务端，但会扩大接口和权限契约，并不必要地改变本轮不涉及的后端与数据库边界；现有上传和文件读取接口已经足够。
- 强制用户使用 Markdown 或完整备份导出导入：安全且已有能力，但日常同库复制体验差，因此只作为浏览器不支持应用格式或剪贴板超限时的明确兜底提示。
- 裸自定义 MIME + paste `getData`：单测 mock 能通过，但在 Chromium 上整次 write 失败或粘贴读不到应用格式，已证实会跨库丢图，因此废弃。
- 每次粘贴都无条件 `clipboard.read()` 并拦截默认行为：能读到 web custom format，但会拖慢/改写所有外部粘贴；改为仅在托管 HTML 标记、需要迁移、或空事件可恢复会话载荷时拦截。

## Consequences

- 同知识库复制保持原素材复用；跨知识库复制会产生目标作用域内的新素材副本，避免跨作用域引用泄漏。
- 剪贴板会携带图片数据并受 128 MiB 总大小上限约束；超过限制或数据损坏时会报错且不插入残缺内容。
- Chromium/Electron 必须使用 `web ` 前缀写入，并用 `clipboard.read()` 读取；同窗口另有内存载荷兜底。不支持自定义剪贴板格式的浏览器仍可安全粘贴普通文字，但带图片复制会提示使用导出导入（内存载荷仍可能让同窗口粘贴成功）。
- HTML 回退保留同作用域的托管图片节点，并可迁移带来源标记、来源未知、或仅剩内联 `data:` 的 thought figure；同时清洗脚本、事件属性、未知数据属性和外部图片。迁移数据缺失时会显示明确错误，而不是静默删除图片。
