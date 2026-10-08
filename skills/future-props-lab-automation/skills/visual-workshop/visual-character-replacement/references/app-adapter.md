# Future Props Lab 适配

在同步看板、引用版本或执行制作任务时读取；运行时以 `fpl operations` 的结果为准。

## 原生看板

将生成的六份 `*.md` 内容作为文本节点正文，同一制作记录是它们的唯一数据来源。保留现有分类；人设/场景/分镜沿用已有分类，监督文本使用一个专用“制作监督”分类。分镜的 `group` 使用稳定镜头 ID，标题带具体用途。`tags` 如“待用户确认”“需返修”“已验收”只作为制作元信息，不替代 App 的任务执行状态。

通过 `visual.get_canvas` 读取最新 revision，再使用 `visual.apply_canvas_operations` 小批量有意更新。保存已有节点 ID 到 `app_nodes`，再次同步更新相同节点，不重复插入、不替换整份用户画布。六份文本过大时按完整镜头拆成记录节点，不截断验收证据；正文上限和批次形状从实际 operations 查询。

文本节点接收的连线只能来自文本；画布为无环图。媒体→review 的关系写在文本中的镜头/候选/输出 ID，不作为连线。生成输入才建立连线；文本上下文实际会拼入提示词，不能把监督总览连到生成节点。

## 素材、任务与版本

| 用例 | 发现入口 |
| --- | --- |
| 文件上传/下载/取帧 | `files.upload_file`、`files.download_file`、`files.extract_video_frames` |
| 项目素材 | `visual.import_assets`、`visual.create_asset_reference` |
| 生成能力/任务 | `generation.generation_options`、`generation.create_generation_task`、`generation.get_generation_task` |
| 剪辑素材/时间轴 | `video.import_assets`、`video.get_timeline`、`video.apply_timeline_operations` |
| 成片/检查 | `video.render_preflight`、`video.create_render`、`video.get_render`、`video.exact_frame` |

先发现字段与能力，再从模型无关制作说明组装参数。上传下载使用 CLI 的 `--file` / `--output`；App 素材不通过运行数据路径偷读。每次提交记录 task_id，只轮询原任务。通过当前正式素材导入与时间轴 API 组织成片，不新增 App 间内部调用。

App 新输出可能自动成为 `final_output_id`，不是质量验收。试生成使用独立候选节点；稳定下游使用验收版本，支持时使用 `binding: fixed` + `output_id`，并记录实际输入快照。已生成的下游不会随参考修改自动更新，应标为待复查而非声称自动刷新。

输出历史、上传版本、选择最终版本虽有 HTTP/SDK 方法，但部署的 Agent 白名单可能尚未开放。发现不到时写入 `blockers`，给用户对应的界面操作步骤，保留候选/素材 ID；不绕过白名单、不直接改数据库，不伪造已固定引用的状态。

## 本地对照页与反馈

`render` 将允许的本地媒体复制到预览目录，输出静态 HTML 和文本。源视频/图片/音频需先在授权范围内获取至本次记录目录，用相对路径填写 `media.path`；不能把 URL、凭据或 App 私有运行目录放进模板。模板本身不带真实视频。

浏览器填写反馈 → 下载 JSON → Agent 明确读取 `merge-feedback` → 新制作记录 → 重新渲染 → 按已授权接口同步 App。这是人工提交的快照流程，不是实时 App review 服务。刷新前提示页内未导出的数量，导出只保存文件，仍须合并才生效。

Amadeus 的图片输入和二进制读取有宿主限制；按真实能力提供证据，无法播放/试听时保留未验证，不能用文字描述代替媒体 review。
