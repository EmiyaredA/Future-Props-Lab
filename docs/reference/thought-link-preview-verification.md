# 思绪工坊链接悬浮预览验收

日期：2026-09-14。

## 实现结果

- HTTP/HTTPS 链接悬停 300ms 后显示域名、网页标题、三行以内简介及打开原文入口。
- 编辑、只读、表格、键盘焦点、Escape、触屏首次点击共用同一实现。
- 自绘顶层卡片适配明暗主题及 320px / 390px 窄屏，随滚动定位并避让顶部工具栏。
- 预览不会修改正文；请求可取消，缓存按 Workspace 与 URL 隔离。
- 后端匿名读取公网 HTML 元数据，逐跳检查并固定连接 IP，限制超时、并发与压缩前后响应大小。
- 无数据库迁移，无新增依赖；已同步 API、OpenAPI、Web 类型、SDK 和目录职责说明。

## 验证结果

- 新接口测试 26 项通过，含静态元数据、压缩响应、超时、DNS/重定向限制、未登录拒绝和真实只读成员访问。
- 前端针对性回归 34 项通过，含新预览交互 6 项以及已有正文、块编辑、附件与图片控件。
- Chromium 浏览器旅程 2 项通过：桌面明暗主题、表格引用、连续切换、键盘、窄屏、只读及触屏打开原文。
- `npm run build`、`npm run lint`、`npm run contracts:check`（含 SDK 检查）通过。
- 本次修改文件的格式检查和 `git diff --check` 通过。
- 全量 Web 测试：829 通过、4 失败；后端新接口/架构/SDK/思绪工坊组合：85 通过、2 失败。

全量检查未通过项位于本次未修改的文件：

- `web/tests/docs-content.test.ts`：`video-editor-projects.jpg` 与文档清单 SHA256 不匹配。
- `web/tests/navigation.test.tsx`：文档中心渲染、深链接及视频编辑器指南搜索共 3 项断言失败。
- `tests/test_architecture.py`：账号样式包含应用壳选择器，以及 `web/tests/visual-workshop-canvas.test.tsx` 的 1456 行超过 1200 行限制。
- 全仓库格式检查：`desktop/scripts/build_icon.py` 与 `web/src/features/thought-workshop/KnowledgeDocumentResults.tsx` 不符合当前格式化输出。

以上文件保持原状。测试使用临时隔离数据库及模拟网页，不依赖真实供应商或网站响应。

## 实际界面截图

截图为本地验收产物，未作为产品素材或文档公开图片提交：

- [桌面浅色](../../output/link-preview/desktop-light.png)
- [桌面深色](../../output/link-preview/desktop-dark.png)
- [390px 窄屏](../../output/link-preview/mobile-390.png)
- [320px 窄屏](../../output/link-preview/mobile-320.png)
