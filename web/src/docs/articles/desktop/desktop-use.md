<!-- docs: {"group":"desktop","order":0,"title":"桌面 App、多窗口与本地数据","lead":"在同一 Workspace 打开多个窗口，核对外部更新并管理本机数据。","evidence":["desktop/src","web/src/app/layout/DesktopAppChrome.tsx","docs/operations/desktop-macos.md"]} -->

# 桌面 App、多窗口与本地数据

macOS 桌面版把 Studio 与后端运行在本机。首次启动按界面创建首个账号并登录；后续账号和 Workspace 的管理见[工作空间与账号](/docs.html?page=workspaces)。

## 多窗口工作

使用桌面顶栏的窗口入口，或支持该操作的工坊「新建窗口」，打开当前 Workspace 的另一个窗口。窗口可查看不同项目，但不因此创建另一个部署实例。

账号和空间切换需要处理未保存内容。其他窗口或 Agent 修改项目后，界面会收到外部变更提示；查看更新仍经过草稿保护。存在冲突时核对服务器版本，不把刷新当作自动合并。

## 桌面专属入口

- 顶栏「Amadeus」打开[桌面助手](/docs.html?page=amadeus-start)。
- 桌宠项目的「放到桌面」打开透明角色窗口与独立聊天小窗。
- 文件管理可打开当前空间的本地文件库目录；整理、删除和引用管理仍应通过 App 完成。
- 「工具导航 → Codex 模型源」只向桌面版平台管理员开放。

这些能力依赖桌面桥，普通浏览器中的对应页面不具备相同本机操作能力。

## 数据保存在哪里

正式桌面版数据根为 `~/Library/Application Support/Future Props Lab/`，项目与素材在其中的 `runtime/`，配置在 `backend/config.toml`。项目保存在部署机器，不是当前浏览器的临时存储。

不要直接修改数据库或手工移动被项目引用的素材。完整备份需停止应用并同时保留数据库与资源目录；部署人员参见[桌面运维](/docs.html?page=dev-desktop-macos)。导出单个项目适合创作交接，不能替代完整数据备份。
