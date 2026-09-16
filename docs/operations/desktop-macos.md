# macOS Apple Silicon 桌面版

桌面版保留全部现有工坊，不包含新增 3D 编辑器、自动更新、仓库数据搬迁或公开发布。
Electron 托管现有 Web 页面，独立 PyInstaller 后端提供同源 `/v1` API。

## 构建与安装

构建机需要 Apple Silicon macOS、Xcode Command Line Tools、Node.js 24.15.0、npm 11+、uv、Git LFS
和 arm64 FFmpeg/FFprobe（例如构建机通过 Homebrew 安装）。Python/npm 依赖由锁文件固定。
本机 Node 24.16.0 在 Electron ZIP 解压时提前结束，构建入口会明确拒绝该版本；CI 固定已验证版本。

```sh
uv sync --frozen --all-groups
npm ci
npm run test:desktop
npm run build:desktop
npm run package:desktop
```

`build:desktop` 输出 `desktop/out/Future Props Lab-darwin-arm64/Future Props Lab.app`；
`package:desktop` 同时在 `desktop/out/make/` 生成 DMG 与 ZIP。将 DMG 中的 App 复制到 Applications
后运行即可，无需用户安装开发工具。首期只有本地 ad-hoc 签名，没有 Developer ID、公证、自动更新
或 Release 发布；不要将其宣称为可直接通过 Gatekeeper 的公开发行版。

桌面图标由 `desktop/scripts/build_icon.py` 从 `web/public/brand/brand-mark.png` 确定性生成，
保留人物与齿轮原图，只增加符合 macOS 展示的圆角底板、留白和阴影。构建命令会先刷新
`desktop/assets/app-icon.png` 与 `.icns`，并用于 App、Dock 和 DMG 安装界面。

`dev:desktop` 使用源码 Vite 和仓库 `.venv` 启动热加载开发版并复用正式 App 数据；
`dev:desktop:isolated` 使用独立开发数据，`dev:desktop:live` 是正式数据入口的兼容别名。正式数据首次停机备份后启动。
前端兼容更新即时生效，后端/Electron 更新由用户点击应用，日常不需要
重新制作安装包。行为、安全限制和恢复步骤见 [桌面热加载开发](desktop-development.md)。
普通 `dev`、`start:backend` 与 Web 构建入口保持原部署行为。

## 数据与配置

默认根目录是 `~/Library/Application Support/Future Props Lab/`；隔离开发版使用同级
`Future Props Lab Development/`，两者不会读取仓库 `.runtime` 或 `backend/config.toml`。

- `runtime/future-props.db` 及 `runtime/` 下素材是本机数据真源。
- `backend/config.toml` 首次以 0600 权限创建独立 `security.secrets_key`，可保存分组的后端配置项。
  旧版只有 `.env` 时，升级自动校验并转换，保留原密钥和 0600 `.env.backup-*` 备份。
  已有 TOML 时不读取或合并 `.env`；损坏配置不会触发重新生成密钥。
  数据库路径、同源 CORS 和 HTTP Cookie 模式由桌面入口固定，不接受配置覆盖。
- `logs/backend.log` 保存后端诊断；故障页提供打开日志目录和手动重试。
- `backend.lock` 和 Electron 单实例锁防止同一数据目录启动两个后端。

已有数据库但缺失密钥，或已有配置未填写密钥时停止启动。恢复原 `backend/config.toml`，不要生成新密钥
覆盖已有配置。替换 `.app` 不替换数据；备份前退出 App，将整个数据根目录一并复制并妥善保护密钥。
不要直接操作持久数据库修复状态，管理、导入与导出继续通过正式 API。

用户明确要求的离线整体迁移，必须先停止源后端和 App，备份目标完整数据根目录，再将源
运行数据与原加密密钥配对迁入；不得将此行为加入默认安装流程。外部素材链接应复制为实际文件，
并在切换前核对文件 SHA256 与数据库完整性。Skill 版本内容按当前 Workspace、Skill ID 和版本
定位到新数据根目录，历史记录中的旧绝对路径不作为读取来源；不需要修改数据库记录。

## 启动、安全与退出

后端只监听 `127.0.0.1`，端口由系统分配，通过私有 stdout 握手报告；启动令牌经 stdin 传递。
Electron 等待 `/ready` 再打开业务窗口。每次启动随机凭据只由主进程为当前服务注入 HTTP/WS，
缺少凭据返回 403（WebSocket 1008），业务 Session、CSRF 与 Workspace 校验仍然生效。

渲染器沙箱、上下文隔离与 Web 安全启用，桥不暴露文件路径访问、命令执行或任意 IPC。
外部 HTTP(S) 链接交由系统浏览器；同源 `docs.html` 使用受限独立窗口；其他页面导航留在主窗口。
文件输入保留系统选取器，下载使用系统保存面板；现有快照与项目目录 API 不变。
只允许当前服务页面申请音频采集，不授予摄像头、远端页面或任意文件系统权限。

macOS 关闭主窗口只是隐藏，Dock 可重开。退出先沿用应用内未保存导航提示，再执行页面 unload
检查；取消时后端继续工作。确认后关闭 stdin，等待后端停止任务，超时仅清理其独立子进程组。
主进程异常退出导致 stdin EOF，后端退出；故障不自动重试，避免模型任务重复提交。

静态资源仅从 Web 构建目录读取。无扩展名的 HTML 页面导航可回退 `index.html`，未知 API、
资源目录和缺失带扩展名文件仍为 404。文档 Markdown 由原文档 API 读取包内白名单资源。

## 首次账号接口

`GET /v1/desktop/setup` 返回 `{ "setup_required": true | false }`。
`POST /v1/desktop/setup` 接受 `username`、`display_name` 和 `password`，要求同源 Origin。
不接收 Workspace ID。密码沿用现有强度规则，在初始化短写事务内重验无账号，并复用正式开通
用例创建管理员、认领 default Workspace 与写审计。成功返回 `setup_required: false`，随后使用
原登录 API。并发或重复初始化返回 409，普通 Web 部署两接口返回 404。

## 资源与许可证

打包白名单包含应用 Python 模块、已登记迁移、原生库、中文字体、允许读取的 Markdown、Web
构建资源和 FFmpeg/FFprobe。构建前检测 LFS 指针并按精确路径拉取，缺失或摘要不符则失败。
不收集真实 `.env`、`config.toml`、配置备份、`.runtime`、测试资产或开发缓存。

PyInstaller 收集并重定位动态库；构建验证每个 Mach-O 的 arm64 架构与链接，不允许依赖
`/opt/homebrew` 或 `/usr/local`。在无开发工具 PATH 下启动 FFmpeg/FFprobe。
`fpl-server/resources-manifest.json` 保存后端资源摘要；`_internal/third-party/` 保存工具版本、
源二进制 SHA256、Homebrew 源配方/安装记录及可收集的第三方许可证。Electron 包自带许可信息。
FFmpeg 配置可能含 GPL 组件，后续对外分发前必须独立复核全部许可及对应源代码义务；本期不发布。
Forge 签名后会再次校验整个 App，最终签名文件的摘要以包外
`desktop/out/validation/app-manifest.json` 为准，避免重签名改变原生文件后仍使用签名前摘要。

## 验证

`test:desktop` 使用隔离临时目录验证并发初始化、登录、重启持久化、CSRF、静态路由、无凭据
拒绝、双后端锁和父管道 EOF。可以用 `FPL_TEST_DESKTOP_BINARY` 指向包内后端复用相同测试。
`node desktop/scripts/smoke.cjs` 启动实际 Electron 窗口，以临时目录验证首次使用与窗口行为。
`node desktop/scripts/verify-dmg.cjs "desktop/out/make/Future Props Lab.dmg"` 只读挂载 DMG，复制到临时
安装目录，再验证签名、原生资源、窗口流程和替换 App 后数据保留；不更改用户 Applications。
测试数据覆盖必须同时设置 `FPL_DESKTOP_TEST_MODE=1` 和绝对 `FPL_DESKTOP_TEST_DATA_DIR`，
正常启动忽略测试目录参数。验证记录见 [本机验收记录](desktop-validation.md)。

`.github/workflows/desktop-macos.yml` 只允许手动触发，在 macOS arm64 构建验证并保存产物，
不会创建 Release。真实模型调用不属于无凭证验收，使用现有确定性模型测试替身。
