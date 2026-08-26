# 环境变量

后端只读取 `backend/.env`，可从 `backend/.env.example` 创建。

Web 的 `VITE_API_BASE` 是执行 `npm run build` 时读取的构建变量，不写入 `backend/.env`。同源反向
代理部署保持为空；跨源部署填写 API 的 HTTPS 根地址。完整步骤见生产部署指南。

- `FPL_DATABASE_PATH`：可选 SQLite 文件路径，默认 `.runtime/future-props.db`；相对路径以仓库根目录为准。
- `FPL_VISUAL_ASSET_MAX_BYTES`：文件管理与项目素材的单文件上限，默认 `209715200`（200 MiB）。
- `FPL_GALGAME_EXPORT_MAX_BYTES`：Galgame 导出 MP4 的单文件上限，默认 `8589934592`（8 GiB）。
- `FPL_TEMP_MEDIA_UPLOAD_URL`：可选的视频生成参考音频/视频临时托管上传地址，默认留空。配置后必须是无凭证 HTTPS 地址；未配置时需要外传参考媒体的请求会在发起网络访问前返回明确配置错误。
- `FPL_MCP_STDIO_ALLOWED_COMMANDS`：允许 MCP stdio 启动的绝对可执行文件路径，使用系统路径分隔符
  分隔多项；默认空，即完全禁用 stdio。命令解析后必须精确命中白名单，参数始终按数组传递且不使用 shell。
- `FPL_SKILL_ARCHIVE_MAX_BYTES`：Skill ZIP 单文件上限，默认 `10485760`（10 MiB）。
- `FPL_SKILL_EXPANDED_MAX_BYTES`：Skill 解压后的文件总量上限，默认 `52428800`（50 MiB）。
- `FPL_SKILL_MAX_FILES`：单个 Skill 解压后的文件数量上限，默认 `500`。
- `FPL_SECRETS_KEY`：必填 Fernet 密钥，用于加密供应商 API Key。丢失后旧密钥不可恢复。
- `FPL_AUTH_COOKIE_SECURE`：Session/CSRF Cookie 的 Secure 标志；本机 HTTP 开发默认 `false`，HTTPS 环境必须设为 `true`。
- `CORS_ORIGINS`：允许访问 API 的 Studio 来源，逗号分隔。

标准启动命令固定将后端监听在 `127.0.0.1:9000`，Web 开发服务监听在 `0.0.0.0:3000`。监听地址和端口不是受支持的 `.env` 配置项；临时诊断需要改端口时，应直接向对应开发命令传参，并同步配置 Web API 地址。

模型 API Key、工具 API 密钥、MCP Bearer Token 与 stdio 环境变量只以密文落库，列表接口仅返回
已配置标志、尾部提示或环境变量名称。生产部署必须自行备份 `FPL_SECRETS_KEY`，且不得把 `.env`
提交到版本库。

`FPL_STUDIO_TOKEN` 已被删除；变量仍存在时应用会明确拒绝启动。浏览器使用 HttpOnly
`fpl_session` 与可读 `fpl_csrf` Cookie，写请求还必须携带匹配的 `X-CSRF-Token` 和精确 Origin。
HTTPS 反向代理部署必须同时开启 `FPL_AUTH_COOKIE_SECURE`。账号只由平台管理员或
`npm run account -- create-admin|create-user|reset-password` 创建和恢复，不开放注册或邮件找回。

`FPL_MANAGEMENT_API_KEY` 不是后端配置项。它只能作为调用管理 API 脚本时的短期进程环境变量，
不得保存到 `backend/.env`；使用完成后应清除环境变量并吊销不再需要的 Key。

视频生成时，用户上传的音频和视频先保存在本机素材库。只有管理员显式配置
`FPL_TEMP_MEDIA_UPLOAD_URL` 后，后端才会在数据库事务外把供应商要求公网可达的参考媒体流式上传，
并只在内存中使用返回的同主机 HTTPS 链接。上传使用随机文件名，临时链接、响应正文和素材内容
不会写入任务快照或调用日志。该配置意味着数据会离开本机信任边界；应使用组织审核过、兼容
multipart `file` 字段的内部服务，并确认保留和删除策略。留空时不会回退到公共托管服务。

模型供应商地址同样执行统一出站策略：REST 远程主机只允许 HTTPS，实时语音远程主机只允许 WSS；
HTTP/WS 仅允许 `localhost`、`127.0.0.1` 和 `::1`。历史不安全远程地址会保留，但不能启用或调用。

Web 开发代理已经为 `/v1` 开启 WebSocket upgrade。HTTPS 生产反向代理必须把
`/v1/model-test/realtime` 以 WebSocket 转发到后端，并保留 `Origin`、`Host` 与 Cookie；否则页面会
显示连接失败。实时语音 VAD 的 ONNX、worklet 与 WASM 位于 `web/public/voice-vad/`，
`npm run setup` 会同步资源，构建会校验资源没有缺失或过期。麦克风浏览器权限通常要求 HTTPS 或本机来源。

应用启动时自动执行迁移。手动运行 `npm run db:migrate` 可重复确认迁移，`npm run db:migrate:check` 用于发现待执行迁移或 checksum 漂移。Skill ZIP、解压总量与文件数量可通过上述三个变量限制，根 `SKILL.md` 固定最多 256 KiB。模型测试图片固定为每张最多 8 MiB；语音识别不会自动切片，自定义 Pro 端点单文件最多 100 MB，其余当前模型最多 10 MB，均无需环境变量配置。备份时应先停止应用，再同时复制 SQLite 数据库及数据库同级的 `workspaces/`（包含 Skill 版本）、`profiles/`、`library/assets/`、`applications/`、`model-test/attachments/`、`model-test/references/`、`model-test/generated/` 文件目录，以确保元数据和原始文件一致。

`npm run setup` 不安装 Chromium。FFmpeg 与 FFprobe 必须可从系统命令路径调用；Chromium 仅用于
Playwright E2E，按 Playwright 的安装说明单独准备，不参与正式视频导出。
