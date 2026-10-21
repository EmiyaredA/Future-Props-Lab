# Agent Note: 基于 GrandPerspective 的空间占用工具

Status: implemented

## Problem

用户需要在工具导航中快速查看电脑容量、定位大文件并进入 Finder 手动整理，同时避免增加扫描器、图形引擎和扫描缓存造成磁盘负担。

## Decision

空间占用工具通过正式 API 按需读取目录所在文件系统容量，并交给本机已安装的 GrandPerspective 绘制原生占用图。
Web 仅拥有目录选择、容量概览和打开回执；Electron 仅提供受可信主窗口约束的系统目录选择器。
后端 tool_navigation 拥有安装检测、路径规范化、容量读取和固定参数数组的系统打开用例。

接口沿用 Codex 模型源的桌面私有传输、平台超级管理员 Session 限制，并额外限定 macOS。
API Key 和 Agent 通道不能使用这些本机操作。容量与目录仅保留在页面生命周期内，工具收藏和最近使用复用原状态接口。
打开回执只表示请求已提交；扫描进度与刷新由 GrandPerspective 拥有，超时不自动重试。

## Alternatives considered

- 在 Web 内重建占用图：需要额外扫描数据接口和可视化维护，增加体量及状态同步成本。
- 保存 GrandPerspective 导出快照：增加文件落盘、过期与隐私生命周期处理，日常手动整理无需此能力。
- 仅放外部启动链接：缺少容量概览、目录快捷入口和可靠的本机路径校验。

## Consequences

本功能不引入依赖、数据库迁移、后台扫描或扫描结果持久化，不打包第三方应用，也不改变其权限和偏好。
目录大小和内容由原生工具分析，工坊容量采用文件系统口径，可能不同于系统储存空间分类及可清除空间。
普通浏览器、其他账号及缺少目录选择桥接的旧桌面版本显示不可用提示。
测试使用隔离目录和模拟系统打开，原生验收仅扫描小型验收目录；证据位于 `.local/storage-usage/`。
原生顶栏在窄屏下会将默认 Grid 列撑到最小内容宽度；壳层显式限定单列为 minmax(0, 1fr)，
紧凑顶栏允许换行，工具页验收直接检查元素相对主区域的边界，避免隐藏溢出掩盖裁切。

## Verification

- `uv run pytest -q tests/test_storage_usage.py`：15 项通过，覆盖安装与路径校验、Session/平台权限/桌面边界、参数注入及失败不重试。
- Web 工具、官方知识库、技术文档、响应式覆盖与侧栏相关测试：31 项通过；桌面测试：46 项通过；Web 与桌面 TypeScript/lint、变更文件格式及构建通过。
- `storage-usage.spec.ts`：2 项通过，覆盖实际路由、原生动作协议、外接目录及 390/768/1600 宽度的明暗主题。使用已安装 Chrome，无浏览器下载。
- `node desktop/scripts/smoke-storage-usage.cjs`：独立临时账号和目录，72 KiB 样本通过真实接口打开 GrandPerspective 3.8.1 与 Finder。原生 UI 复核选中 large-sample.txt 后点击“显示”，Finder 正确选中同一文件。
- OpenAPI、Web 类型及 SDK 代码 stale-check 通过，官方导入包与 Agent Note 检查通过。新增页面 JS 为 6.98 kB、CSS 为 3.29 kB，gzip 合计约 4 kB。
- 扩展后端/SDK/架构测试 78 项通过、1 项失败：原有 HomeHeroPet 与 VideoDownloaderPage 的跨 feature 内部导入。根 lint/格式和 Web 全量格式报告原有视频下载等范围外文件问题。
- 既有工具导航 E2E 回归 3 项通过、2 项失败：导航顺序断言未计入已有的创意工坊入口，录音标注用例的“管理”选择器匹配两个按钮。这些失败与新增空间用例和布局边界无关，未改写范围外测试。
- 完整契约检查因受保护的 sdk-reference-tools.md 需要同步而失败；遵守仓库保护规则，未修改生成脚本或重写该页面。API 参考与官方指南已更新，SDK 覆盖清单使用原生成器输出。
- 文档中心保护检查报告开工前已有的 sdk-reference-inference.md 与 sdk-reference-models.md 改动，本功能未新增受保护路径变更。
