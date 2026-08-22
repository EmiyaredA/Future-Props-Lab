# Story 1.4 迁移运维

Story 迁移必须通过受鉴权的 `/v1` API 执行。禁止直接修改 SQLite、Story JSON、
`schema_migrations` 或运行期文件。以下流程适用于把数据库内 Story 1.0–1.3 固化为 1.4；外部旧文件
应使用单工程导入接口，不进入 Workspace 批量迁移。

## 迁移前

1. 通知当前 Workspace 的编辑者停止修改 Story，并等待页面保存完成。
2. 停止应用，按[备份与恢复](troubleshooting.md#备份与恢复)同时备份数据库和全部运行期素材目录。
3. 启动应用，确认 `/ready` 健康，并使用绑定目标 Workspace、包含 `studio:write` scope 的
   Management API Key 或管理员 Session 执行后续请求。
4. 调用 `GET /v1/galgame-workshop/story-migrations/status`。响应中的 `pending` 是可迁移旧文档，
   `invalid` 是无法安全归一化的文档，`current` 是已通过校验的 1.4 文档。

任何 `invalid > 0` 都是发布阻断项。先通过正常 Story API 或旧文件导入接口修复对应工程；不要在
数据库或运行期目录中手工改 JSON。

## 分批执行

调用 `POST /v1/galgame-workshop/story-migrations/run`，请求体为 `{ "limit": 100 }`。`limit` 可取
1–100；每次只处理调用开始时观察到的最多该数量旧文档。

响应字段含义：

- `migrated`：本批成功 CAS 写入 1.4 的数量；
- `conflicts`：扫描后被其他请求更新、因此未覆盖的数量；
- `invalid`：当前仍无效的数量；
- `remaining`：当前仍待迁移的数量；
- `current` / `total`：当前格式数量和总数。

接口是幂等的；已迁移文档不会再次增加 revision。出现 `conflicts > 0` 时停止编辑后重新调用即可，
不要降低或绕过 revision。重复执行直至状态接口同时返回 `pending=0`、`invalid=0`，再抽查工程的编辑、
保存和试玩流程。

## 导入旧文件

调用 `POST /v1/galgame-workshop/projects/{project_id}/story/import`，multipart 表单必须包含：

- `expectedRevision`：最后读取到的当前 Story revision；
- `file`：UTF-8 JSON，最大 10 MiB，仅接受 Story 1.0–1.3。

导入会先完整转换并校验，再通过主 Story 保存用例执行素材校验和 CAS。冲突返回 409，应重新读取并
人工确认后再导入；无效或已经是 1.4 的文件返回 422。Story 1.4 继续使用主 `PUT .../story` 接口。

## 发布门槛与回退

只有满足以下全部条件，后续版本才可以移除主读取、保存、播放和前端状态中的旧格式兼容：

- 已按同一时间点完成数据库和素材备份；
- 编辑保持停止；
- 状态接口返回 `pending=0`、`invalid=0`；
- 关键工程已完成读取、保存和试玩抽查。

需要回退时先停止应用，整体恢复迁移前同一时间点的数据库和所有素材目录，再启动并检查 `/ready`
和迁移状态。不要只恢复数据库或只恢复素材，也不要尝试把 1.4 文档手工降级。
