# 环境变量

后端只读取 `backend/.env`，可从 `backend/.env.example` 创建。

- `FPL_DATABASE_PATH`：可选 SQLite 文件路径，默认 `.runtime/future-props.db`；相对路径以仓库根目录为准。
- `FPL_SECRETS_KEY`：必填 Fernet 密钥，用于加密供应商 API Key。丢失后旧密钥不可恢复。
- `FPL_STUDIO_TOKEN`：可选管理令牌；配置后至少 32 字符，所有模型和日志接口要求 `X-Studio-Token`。
- `CORS_ORIGINS`：允许访问 API 的 Studio 来源，逗号分隔。

模型 API Key 只以密文落库，列表接口仅返回已配置标志和尾四位。生产部署必须自行备份 `FPL_SECRETS_KEY`，且不得把 `.env` 提交到版本库。

应用启动时自动执行迁移。手动运行 `npm run db:migrate` 可重复确认迁移，`npm run db:migrate:check` 用于发现待执行迁移或 checksum 漂移。备份 SQLite 时应先停止应用，再复制数据库文件，以确保 WAL 中没有尚未合并的写入。
