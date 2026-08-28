# 故障排查与恢复

## 安装或启动失败

先确认 Node.js 24、npm 11+、Python 3.11+ 和 Git LFS，再运行 `npm run setup`。若提示字体、ONNX
或 WASM 仍是 LFS 指针，按错误中的 `git lfs pull --include=...` 命令拉取对象，再运行
`npm run lfs:check`。后端只读取 `backend/.env`；`FPL_SECRETS_KEY` 必须是有效 Fernet key。端口被
占用时先停止占用 3000 或 9000 的本机进程，标准 `.env` 不支持 `APP_HOST`、`APP_PORT`。

`/health` 只表示进程可响应，`/ready` 还会检查数据库和全部后台 Runner。若 `/ready` 失败，先查看
应用日志中的 Runner 名称和异常类型，再运行 `npm run db:migrate:check` 检查迁移状态；不要直接修改
SQLite、`schema_migrations` 或 migration checksum。Runner 退避与恢复流程见
[后台 Runner 运维](background-runners.md)。

首次升级账号系统后，运行 `npm run account -- create-admin --username <用户名>` 创建管理员并认领
`default` Workspace。若环境里仍有 `FPL_STUDIO_TOKEN`，后端会拒绝启动；删除它后改用账号 Session
或 Management API Key。管理员遗失密码时使用 `npm run account -- reset-password --username <用户名>`。

## 契约或 Web 构建失败

后端 schema 改变后运行 `npm run contracts:generate`，检查生成差异并同步 Web 消费端。`npm run contracts:check` 失败通常意味着 OpenAPI 快照或 TypeScript 生成物过期。生成文件只通过命令更新，不手工编辑。

## 保存冲突

Story、画布和配置使用 revision/CAS。HTTP 409 表示服务器已有更新，应重新读取当前快照、人工合并后再保存；不得移除 revision 或静默覆盖。422 通常表示缺少 revision 或文档不符合当前契约。

## 素材与生成任务

素材缺失时先在文件管理或项目素材页检查引用和实际文件，不要直接向运行期目录补写数据库记录。供应商生成失败时检查供应商是否启用、模型能力、加密密钥和调用日志；不要把 API Key、供应商原始响应正文或临时素材链接复制进 issue。

视频参考媒体只在管理员显式配置 `FPL_TEMP_MEDIA_UPLOAD_URL` 后外传。留空时系统不会产生上传网络
请求，而会返回配置错误；配置该地址前应确认数据保留、访问控制和删除边界。端点必须兼容 multipart
`file` 字段并返回同主机 HTTPS 地址。

## 集成中心验证

工具 API 或 MCP HTTP 验证失败时，先检查 URL、远端证书和认证配置。远程地址必须使用 HTTPS，
只有 `localhost`、`127.0.0.1` 与 `::1` 可使用 HTTP；重定向和解析到私网、链路本地或多播地址会被
拒绝。验证记录只保留状态、耗时、状态码和脱敏摘要，不会保留响应正文。

MCP stdio 默认禁用。需要启用时，把经过审核的绝对可执行文件加入
`FPL_MCP_STDIO_ALLOWED_COMMANDS` 并重启应用；不要加入 shell 或通用脚本解释器。Skill 导入失败时
按页面校验结果修复 ZIP，禁止直接把文件复制到运行期目录或修改数据库记录。

## 备份与恢复

备份前停止应用，并一次性复制：

- SQLite 主文件 `.runtime/future-props.db`；
- `.runtime/workspaces/`（包括集成中心 Skill 版本）与 `.runtime/profiles/`；
- `.runtime/library/assets/`；
- `.runtime/applications/`；
- `.runtime/model-test/attachments/`、`references/`、`generated/`。

若 `FPL_DATABASE_PATH` 改到其他位置，上述素材目录位于数据库同级目录。恢复时也应停止应用，整体恢复同一时间点的数据库和文件目录，再启动并检查 `/ready`。单独恢复数据库或素材目录可能造成引用不一致。

## 交付前复核

按 `CONTRIBUTING.md` 的验证矩阵运行全部质量命令，并在全新检出目录用锁文件安装验证。确认 Git 状态不包含 `.env`、`.runtime/`、`output/`、`tmp/`、下载视频、`.DS_Store` 或真实凭证。
