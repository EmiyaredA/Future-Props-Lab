# 环境变量

后端只读取 `backend/.env`，可从 `backend/.env.example` 创建。

- `FPL_DATABASE_PATH`：可选 SQLite 文件路径，默认 `.runtime/future-props.db`；相对路径以仓库根目录为准。
- `FPL_VISUAL_ASSET_MAX_BYTES`：文件管理与项目素材的单文件上限，默认 `209715200`（200 MiB）。
- `FPL_TEMP_MEDIA_UPLOAD_URL`：视频生成参考音频/视频的临时托管上传地址，默认 `https://temp.sh/upload`。必须是无凭证 HTTPS 地址。
- `FPL_SECRETS_KEY`：必填 Fernet 密钥，用于加密供应商 API Key。丢失后旧密钥不可恢复。
- `FPL_STUDIO_TOKEN`：可选管理令牌；配置后至少 32 字符，所有模型和日志接口要求 `X-Studio-Token`。
- `CORS_ORIGINS`：允许访问 API 的 Studio 来源，逗号分隔。

模型 API Key 只以密文落库，列表接口仅返回已配置标志和尾四位。生产部署必须自行备份 `FPL_SECRETS_KEY`，且不得把 `.env` 提交到版本库。

视频生成时，用户上传的音频和视频先保存在本机素材库。任务提交供应商前，后端会在数据库事务外把这些文件流式上传到临时托管地址，并只在内存中使用返回的 HTTPS 链接。上传使用随机文件名，临时链接、响应正文和素材内容不会写入任务快照或调用日志。默认服务 `temp.sh` 当前声明文件约保留 3 天；如组织策略不允许使用该服务，可将配置替换为兼容 multipart `file` 字段、返回同主机 HTTPS 文件地址的内部服务。

应用启动时自动执行迁移。手动运行 `npm run db:migrate` 可重复确认迁移，`npm run db:migrate:check` 用于发现待执行迁移或 checksum 漂移。模型测试图片固定为每张最多 8 MiB，无需环境变量配置。备份时应先停止应用，再同时复制 SQLite 数据库及数据库同级的 `visual-workshop/assets/`、`model-test/attachments/`、`model-test/generated/` 文件目录，以确保元数据和原始文件一致。
