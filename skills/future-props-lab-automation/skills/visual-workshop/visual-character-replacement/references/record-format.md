# 制作记录与模板命令

本地 Python 工具使用标准库，不导入后端或 SDK，不执行网络、App 写入或模型调用。空白记录和三镜头演示分别位于 `assets/templates/record.json`、`demo.json`。初始化可使用 `init --demo`，演示检查始终不是生产验收。

## 记录结构

| 字段 | 用途 |
| --- | --- |
| schema_version / record_id / revision | 格式版本 1、制作身份、递增快照版本 |
| updated_at / demo / project_id / phase | 快照时间、演示标记、App 项目归属、制作阶段 |
| brief.preserve / replace | 必须保留与允许改变的要求 |
| source | 原始媒体与声音策略 |
| characters / scenes | 稳定 ID、name、mapping/description、独立参考媒体列表 |
| shots | 源时间、人物映射、参考、动作段落、候选、意见、返修、采用 |
| gates | scheme / representative / final 三个用户质量关口 |
| final | 成片候选、required_checks、summary 与未解决 issues |
| blockers / next_steps / app_nodes | 能力缺口、下一步与 App 监督节点 ID 映射 |

`shots` 的完整填写形状见演示 JSON。`type` 为 person / interaction / scene / graphic / preserve；`execution_status` 为 not_started / running / completed / failed，只描述实际执行。`stage`、`next_step` 为中文文本；`representative` 标记代表镜头。`source_range` 为绝对源时间 `[开始秒, 结束秒]`。`segments` 可为空；非空时连续覆盖完整镜头，附拆分 `reason`。

`references` 为 role（identity / space / action / timing）、description 与可选 media，允许补充 asset_id/node_id/output_id。`character_ids` / `scene_id` 引用当前记录内 ID；无人镜头人物列表为空。

候选具有 id、label、stage（still / motion / graphic / final）、node_id、task_id、asset_id、output_id、media、input_snapshot、checks。尚无 App 标识时填 null，不伪造 ID。input_snapshot 保存真实输入版本与执行参数摘要，不能含凭据。`selected_candidate_id` 仅指工作台默认展示；`adopted` 才表示明确采用。

## 媒体和证据

media 可以为 null，否则必须有 kind（image / video / audio）、path（记录目录内的相对路径）和实际文件 sha256。可附 offset/duration 指定片段，单位为秒。用 SHA256 锁定素材内容；内容改变需更新记录并重新检查。工具拒绝 URL、绝对路径、路径穿越与越界符号链接。缺失媒体显示提示，内容哈希不一致拒绝渲染，避免展示错误版本。

候选 `required_checks` 在镜头上设置；四维 technical/static/dynamic/audio 按实际交付需求选择。检查记录：

```json
{
  "dimension": "dynamic",
  "verdict": "fail",
  "subject_hash": "fingerprint 命令返回的该候选哈希",
  "note": "转头时搭肩接触断开",
  "evidence": [
    { "kind": "playback", "time": 1.2, "end": 1.8, "text": "正常速度回看该候选的接触变化" }
  ]
}
```

只有真实完成检查后才填 pass。通过对应维度必须有 probe/frame/playback/listen 证据。检查时间相对候选，而非源片；未检查维度不填或填 unverified。原片、参考、输入快照、所需维度、镜头要求和候选变化会改变绑定哈希；只改显示标签或记录检查不会使自己的检查失效。

用户意见在 `decisions` 中追加，含 candidate_id、subject_hash、decision、note、at。采用形状为 `{"candidate_id":"…","subject_hash":"…"}`；所需检查必须通过且不存在有效驳回/修改要求。历史检查、意见和关口确认保留；哈希过期显示 stale。成片检查使用 `fingerprint.final_checks` 绑定。

## 命令

- `init --title ... --output ... [--demo]`：生成唯一记录 ID 和快照时间。默认不覆盖。
- `validate --input ...`：检查记录结构、身份引用、动作分段和证据形状，不声称媒体/审美验收。
- `fingerprint --input ...`：输出快照、各镜头候选、关口及成片检查哈希。
- `reconcile --input ... --expected-revision N --output ...`：在当前版本基础上增加 revision，清除已失效采用，保留历史。
- `render --input ... --output-dir ...`：生成自包含 index.html、六份中文 Markdown 和本地媒体副本。非空目录需显式 `--overwrite`，不会删除无关文件。
- `merge-feedback --input ... --feedback ... --output ...`：拒绝错误身份、过期版本/快照、未知候选、重复对象、空意见和错误关口确认。成功后追加意见并增加 revision；不创建 App 任务。

写记录命令需显式 `--overwrite` 才覆盖已有输出；更新时优先生成新文件并复核。每次修改制作要求/候选后先 reconcile，再重新 fingerprint 检查并渲染。脚本只校验输入快照 revision，调用者仍应串行写本地记录；正式 App 写入独立遵守 CAS。

HTML 导出反馈包含 schema_version、record_id、revision、snapshot_hash、entries。候选 entries 带 kind=candidate、shot_id、candidate_id、subject_hash、decision、note；关口带 kind=gate、gate、subject_hash、decision、note。批准关口需满足前置确认及已记录检查，不能用人工批准填补尚无证据的检查。页面导出不等于合并，不自动保存未导出草稿。

三个关口默认按 scheme → representative → final 顺序提交。批量导出的候选意见先合并，再判断关口条件，避免反馈排列顺序影响判定。成片批准需要所有替换镜头已明确采用、代表镜头已确认、成片所需检查通过且无未解决 issues。
