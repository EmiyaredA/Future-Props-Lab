# 视觉创作工坊：看板与节点输出

画布与看板使用同一项目文档、节点 ID 和输入连线。看板的项目素材树按主分类与可选分组整理，默认人设、场景和分镜，可增加自定义分类。文本、图像、音频与视频是节点类型，用途标签独立保存。

## 版本与最终输出

每次上传到已有节点、显式保存文本或成功生成都新增一个服务器维护的版本并成为最终输出。历史预览不修改最终输出；用户可另行选择旧版本作为最终输出。开始生成和失败不清空已有结果。版本列表分页，不靠前端轮询覆盖素材。删除历史版本不删除媒体文件；最终版本与被固定引用的版本受删除保护。

普通媒体上传使用 `POST /v1/visual-workshop/projects/{project_id}/node-uploads`，multipart 字段为 `file`、`expected_revision` 和可选 `x`、`y`。文件、节点、v1 与文档 CAS 原子保存。已有节点使用 `POST .../nodes/{node_id}/output-uploads`，上传类型必须与节点一致。

| 方法 | 项目内路径 | 内容 |
| --- | --- | --- |
| GET | `/nodes/{node_id}/outputs?page=1&page_size=20` | 分页历史（版本降序） |
| GET | `/nodes/{node_id}/outputs/{output_id}` | 具体版本及提交输入快照 |
| POST | `/nodes/{node_id}/outputs` | `expected_revision` 与文本 `text`，或已托管素材 `asset_id` |
| PUT | `/nodes/{node_id}/final-output` | `expected_revision`、`output_id`；选择最终版本 |
| DELETE | `/nodes/{node_id}/outputs/{output_id}?expected_revision=...` | 删除非最终、未被固定引用版本 |

上述路径均以 `/v1/visual-workshop/projects/{project_id}` 为前缀。写入要求当前画布 revision；冲突返回 409 与当前快照，不静默覆盖。读写使用视觉工坊固定权限并按 Principal 的 Workspace 校验；跨 Workspace 返回不存在。

生成记录与批次列表支持 `current_nodes=true`（须提供 `project_id`）。仅返回节点当前关联记录和仍在运行的记录；看板使用此投影，避免分页读取全部历史。普通历史列表保持原含义。

## 引用与生成

连线保存 `source_node_id`、`target_node_id`、`binding`（`final` 或 `fixed`）、`purpose`（`reference`、`context`、`first_frame` 或 `last_frame`）及固定模式的 `output_id`。禁止自引用与依赖环；固定版本必须属于上游节点。没有输出的节点不能在看板新选为输入。旧画布占位连线保持兼容，提交时等待上游输出。

跟随绑定在每次提交时解析当时的最终版本；固定绑定始终使用选定版本。文本作为提示词上下文，媒体按目标模型能力校验。提交记录中的 `input_snapshot` 保存具体节点、版本和素材；上游更新不改写在途请求，不自动重生成下游。已有结果与当前输入不一致时工作台提示使用了旧版本。删除被引用节点需先解除引用，删除节点保留媒体文件。

图片请求增加有序 `reference_asset_ids`，保留旧单图 `reference_asset_id`。两者合并并去重，保留首次出现顺序。SenseAudio 最多 1 张；方舟 `volcengine_image` 首批支持 `doubao-seedream-4-5-251128`，最多 14 张 PNG/JPEG/WebP，使用原生数组并关闭组图，每次返回一张。模型选项公开数量、格式、尺寸、种子支持和提示词上限；不截断、不换模型。方舟密钥在模型中心配置。同步结果先持久化下载地址，再由共享任务驱动落盘和归档；提交中断安全失败，恢复不重提供应商请求。

## 兼容与备份

`r0086_visual_node_outputs` 只回填可靠归属的完成记录和节点当前输出，保留节点、布局、连线与原 revision。无法证明归属的旧文件仍保留，通过素材导入或版本 API 显式关联。`r0087_volcengine_images` 扩展供应商约束，保留原任务与模型凭证。

快照包含分类、分组、所有输出历史、最终版本和固定引用；导入重新映射节点、连线、输出与素材 ID，保留版本编号、来源和时间。调用记录标识作为来源审计保留，不重建供应商任务。旧快照当前素材恢复为 legacy v1。

验收使用隔离数据库和模拟供应商；不调用付费模型。后台登记与用户编辑并发、重复完成、CAS、Workspace、迁移及快照由自动化测试验证。验收产物位于已忽略的 `.local/task-board/`。
