# 环境变量

后端只读取 `backend/.env`，可从 `backend/.env.example` 创建。

- `FPL_DATABASE_PATH`：可选 SQLite 文件路径，默认 `.runtime/future-props.db`；相对路径以仓库根目录为准。
- `FPL_VISUAL_ASSET_MAX_BYTES`：文件管理与项目素材的单文件上限，默认 `209715200`（200 MiB）。
- `FPL_GALGAME_EXPORT_MAX_BYTES`：Galgame 导出 MP4 的单文件上限，默认 `8589934592`（8 GiB）。
- `FPL_GALGAME_RENDERER_URL`：后台隔离渲染页的本机地址，开发环境默认 `http://127.0.0.1:3000/galgame-export.html`；不接受带凭证或非本机主机的 URL。
- `FPL_TEMP_MEDIA_UPLOAD_URL`：可选的视频生成参考音频/视频临时托管上传地址，默认留空。配置后必须是无凭证 HTTPS 地址；未配置时需要外传参考媒体的请求会在发起网络访问前返回明确配置错误。
- `FPL_SECRETS_KEY`：必填 Fernet 密钥，用于加密供应商 API Key。丢失后旧密钥不可恢复。
- `FPL_AUTH_COOKIE_SECURE`：Session/CSRF Cookie 的 Secure 标志；本机 HTTP 开发默认 `false`，HTTPS 环境必须设为 `true`。
- `CORS_ORIGINS`：允许访问 API 的 Studio 来源，逗号分隔。

标准启动命令固定将后端监听在 `127.0.0.1:9000`，Web 开发服务监听在 `0.0.0.0:3000`。监听地址和端口不是受支持的 `.env` 配置项；临时诊断需要改端口时，应直接向对应开发命令传参，并同步配置 Web API 地址。

模型 API Key 只以密文落库，列表接口仅返回已配置标志和尾四位。生产部署必须自行备份 `FPL_SECRETS_KEY`，且不得把 `.env` 提交到版本库。

`FPL_STUDIO_TOKEN` 已被删除；变量仍存在时应用会明确拒绝启动。浏览器使用 HttpOnly
`fpl_session` 与可读 `fpl_csrf` Cookie，写请求还必须携带匹配的 `X-CSRF-Token` 和精确 Origin。
HTTPS 反向代理部署必须同时开启 `FPL_AUTH_COOKIE_SECURE`。账号只由平台管理员或
`npm run account -- create-admin|create-user|reset-password` 创建和恢复，不开放注册或邮件找回。

视频生成时，用户上传的音频和视频先保存在本机素材库。只有管理员显式配置
`FPL_TEMP_MEDIA_UPLOAD_URL` 后，后端才会在数据库事务外把供应商要求公网可达的参考媒体流式上传，
并只在内存中使用返回的同主机 HTTPS 链接。上传使用随机文件名，临时链接、响应正文和素材内容
不会写入任务快照或调用日志。该配置意味着数据会离开本机信任边界；应使用组织审核过、兼容
multipart `file` 字段的内部服务，并确认保留和删除策略。留空时不会回退到公共托管服务。

模型供应商地址同样执行统一出站策略：远程主机只允许 HTTPS；HTTP 仅允许 `localhost`、
`127.0.0.1` 和 `::1`。历史不安全远程 HTTP 记录会保留，但不能启用或调用。

应用启动时自动执行迁移。手动运行 `npm run db:migrate` 可重复确认迁移，`npm run db:migrate:check` 用于发现待执行迁移或 checksum 漂移。模型测试图片固定为每张最多 8 MiB；语音识别不会自动切片，自定义 Pro 端点单文件最多 100 MB，其余当前模型最多 10 MB，均无需环境变量配置。备份时应先停止应用，再同时复制 SQLite 数据库及数据库同级的 `workspaces/`、`profiles/`、`library/assets/`、`applications/`、`model-test/attachments/`、`model-test/references/`、`model-test/generated/` 文件目录，以确保元数据和原始文件一致。

`npm run setup` 会安装视频导出使用的隔离 Chromium；FFmpeg 与 FFprobe 必须可从系统命令路径调用。
渲染器不复用用户 Chrome，不读取登录态，并只通过任务清单访问当前项目已校验的本机素材。
