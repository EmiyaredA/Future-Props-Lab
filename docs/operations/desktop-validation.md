# 桌面版本机验证记录

本期验证平台：Apple Silicon，macOS 15.7.2，Python 3.11.14，Electron 41.10.7，
Forge 7.11.2，PyInstaller 6.22.3。构建工具使用 Node 24.15.0。
本地产物仅 ad-hoc 签名，未 Developer ID 签名、未公证、未发布 Release。

## 已验证

- 源码及 PyInstaller 后端：独立临时数据、首次管理员、并发只有一次成功、登录、Session 与
  CSRF、创建项目、素材上传、快照导入导出、重启恢复、缺失密钥停机、重复数据目录锁、父管道 EOF。
- Electron 实际窗口：首次引导、760/1280 宽度、沙箱与凭据边界、登录、项目创建、重复启动、
  主窗口隐藏与 Dock 事件重开、同源文档窗口、VAD 模型资源、深层页面刷新、未保存导航拦截与重启恢复。
- 新增 Web 首用组件及原账号组件：9 项通过。桌面来源、异常握手和启动超时单元测试：5 项通过。
- 最终 App 内后端隔离测试：7 项通过，包含 SSE 分块与 WebSocket 凭据校验。
- 最终签名 App 的 1577 个资源已生成 SHA256 清单；arm64、无 Homebrew 动态库链接、
  中文字体、SVG 栅格化、PPTX、文档读取、FFmpeg 短视频和 FFprobe 探测通过。
- 从 DMG 只读挂载后复制到临时安装目录，在 `/usr/bin:/bin` PATH 与任意工作目录运行通过；
  替换已安装 App 后账号和项目保留。后端强制退出后的故障页/手动重试，以及主进程强制退出
  后的后台清理均通过。挂载已卸载，未更改用户的 Applications 目录。
- 首用主按钮已改为暖陶色渐变、圆角、轻阴影、箭头、加载动画和键盘焦点环，
  明暗主题实际窗口截图分别保存为 `setup-light.png`、`setup-dark.png`。
- 首用密码与确认密码框提供相互独立的显示/隐藏按钮，支持键盘焦点与无障碍名称；
  App 实测确认切换一个输入框不会暴露另一个，提交完成后两者恢复隐藏。
- App、Dock 与 DMG 已使用基于项目原始品牌图生成的 macOS 图标；打包后的 `electron.icns`
  与构建母版逐字节校验一致，SHA256 为
  `b26c3d28beef4462a982f84891442f4a69290dfb14270d96d68796f9a8e9c0a8`。
- 项目 lint 与契约/SDK stale-check 通过。Web 构建通过。
- 用户授权的本机数据迁移后，74 张表记录数量一致，3,132 个素材文件与 10 个 Skill 内容可用，
  7 份供应商配置解密通过。Skill 目录搬迁回归及相关集成测试 11 项通过；新版 App 启动与重启通过。
  用户登录后，17 个项目详情、笔记历史和 10 个 Skill 下载通过；正常退出后重启保留账号 Session。

签名后最终资源清单和原生导出检查由 `verify-app.cjs` 自动生成到
`desktop/out/validation/app-manifest.json`；实际 Electron 验收结果和截图由 `smoke.cjs` 保存到
同目录。所有账号和项目写入均使用正式 `/v1` API，未访问或搬迁仓库运行数据。

## 原有质量门禁问题

本次全量后端测试：623 通过、4 失败、1 跳过。失败项位于未修改的业务文件：

- `account-navigation.css` 覆盖应用壳选择器，违反既有架构检查。
- `visual-workshop-canvas.test.tsx` 1456 行，超过 1200 行上限。
- 原文档素材清单与现有 CG 数量及截图摘要不一致。
- 快照测试的预期字段未包含已有的 `grid_output`、`grid_size`。

全量 Web 测试：805 通过、4 失败；失败为文档截图摘要及 3 个导航标题断言。
全局 format check 还报告未修改的 `KnowledgeDocumentResults.tsx`；新增文件格式检查通过。
这些问题未通过放宽断言、调整架构基线或覆盖无关文件绕过。

## 验收边界

窗口自动化使用测试进程和临时数据目录，不替代另一台全新 Mac 的实体安装验证。
系统麦克风授权的人机确认、真实供应商语音/模型网络请求和 Developer ID/Gatekeeper 公证未验收。
SSE/WS 使用确定性传输测试与原业务回归，不发起真实付费请求。
GitHub 手动构建工作流尚未在远端运行。使用的 `macos-15` 标签经
[GitHub 官方 runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
核对为 arm64，并在任务内另有架构断言。

## 本地交付

- App：`desktop/out/Future Props Lab-darwin-arm64/Future Props Lab.app`，约 458 MiB。
- DMG：`desktop/out/make/Future Props Lab.dmg`，约 208 MiB。
- DMG SHA256：`b7ae2c25ab46d8e396c05e1927f00d45c4ee8be86824292d5a03a5aa646ce878`。
- 密码开关版本的安装回归：`desktop/out/validation/dmg/electron-smoke.json`（13 项通过）；
  后续 Skill 搬迁兼容版另已完成本机实际数据迁移、资源签名检查与启动/重启验证。

以上是本机验证结果，不代表全部项目质量门禁通过，也不代表已完成公开发行审核。
