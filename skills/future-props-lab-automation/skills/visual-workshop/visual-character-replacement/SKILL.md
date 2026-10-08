---
name: visual-character-replacement
description: 用于在 Future Props Lab 视觉创作工坊中替换原片人物与可选场景，保留镜头表演和剪辑结构，组织参考、候选、监督看板、review、返修与成片验收。适用于已有视频或分镜的替换制作；具体模型与运行策略由上层决定。
---

# 人物与场景替换

将替换制作落实为可追溯的镜头、参考、候选和验收记录。使用随包模板生成 App 文本看板及本地 HTML 对照页；复用当前项目已有成果。

## 前置（单独安装时必做）

- 本地模板工具只需 Python 3.10+ 标准库。先确定用户指定的项目、源片、目标人物、可选场景与交付范围；只补问真正缺失的信息。
- 操作 App 前，使用 `fpl connect --name "<代理名>"`、`fpl status` 和 `fpl operations` 发现授权能力。无接入时可以先准备本地制作记录，不能声称已更新 App。
- 沿用上层的模型、供应商、工具、运行环境、成本、并发与迭代额度。本 skill 不选择固定模型，不要求特定模态输入或部署方式。
- 正式素材和项目写入只走开放的 CLI/SDK/API；CAS 冲突重新读取并有意合并。提交中断或状态不明时不得重提；质量返修是有明确理由的新候选，不是失败重试。
- 临时产物放在宿主允许的任务目录；在本仓库使用先经 `git check-ignore` 确认的 `.local/` 子目录。不要操作持久数据库或修改 App 源码、配置与权限。

## 工作流与三个质量关口

1. **盘点与方案**：读取现有画布、素材、任务和可用版本；记录人物映射、场景变化、必须保留项。区分人物、互动、场景、图形与原样保留镜头。已有参考优先复用。更新制作总览与角色参考模板。
2. **拆镜与参考**：按真实切镜定位源时间，长镜头按动作阶段规划衔接，记录可用区间和拆分理由。身份、起始构图/空间、动作、时间节奏参考各负其责；只给当前镜头必要的素材。具体做法见 [镜头规划](references/shot-planning.md)。
3. **方案确认**：替换方案和角色参考准备完毕后等待用户确认 `scheme` 关口。已有确认仅在其要求与参考仍一致时有效。质量确认不替代 App 操作授权。
4. **代表镜头**：选取能暴露共同风险的镜头，先检查起始画面，再检查动态；覆盖身份、侧脸、接触或复杂动作等实际风险。代表镜头通过 Agent 检查后，等待用户确认 `representative` 关口，再批量推进。
5. **逐镜制作与返修**：保存参考快照与候选；在上层额度内检查、定位根因、修正并比较新旧结果。每阶段更新镜头卡、候选对照和返修记录。用户驳回应优先处理；不要用 Agent 结论覆盖用户意见。见 [review 与返修](references/review-and-refinement.md)。
6. **回填与整片**：按源时间轴使用明确采用的候选，检查衔接、节奏累积偏差、身份连续性与音轨。原片无需替换的部分沿用原素材。默认保留原声；用户另有声音要求时按其要求，不承诺当前导出能逐包无损复用音轨。
7. **最终确认**：生成成片验收看板，检查实际导出文件，列出未验证项与遗留问题，等待用户确认 `final` 关口。保存采用清单和有证据的制作经验，不自动改写本 skill。

## 制作记录与用户监督

- `assets/templates/record.json` 是空白制作记录，`assets/templates/demo.json` 是明确标为演示的填写样例，均不含真实媒体。复制并填写，不修改 skill 模板本身。
- JSON 是制作记录真源；HTML 和 App 文本都由同一份记录生成。新结果、review 或用户决定到达后更新记录、增加 revision，并重新生成快照；不依靠 HTML 自动刷新 App。
- 每个候选记录节点、任务、素材、输出标识及 `input_snapshot`。对具体候选计算 `subject_hash`，检查、采用决定、用户意见绑定此哈希。参考、镜头要求或候选改变后旧结果显示“待复查”；不得继续当作验收通过。
- HTML 提供源片/候选并排展示、证据定位、筛选、返修历史、用户反馈和三个关口的确认。反馈导出后由 Agent 明确读取合并；未导出的意见不会写入记录。无媒体时显示缺失提示，不能把示例卡片当生成结果。
- 严格区分技术/静态/动态/音频证据；抽帧不能证明动作连续或声音正常。待用户判断、证据不足、未验证必须如实显示。
- App 分类与标签承载 review 元信息，原生任务状态仍由 App 决定。媒体节点只连接真实生成输入；review 文本不参与生成依赖环。同步与能力缺口见 [App 适配](references/app-adapter.md)。

## 最小可运行示例

命令中的 `SKILL_DIR` 指解压后的本 skill 根目录，`WORK_DIR` 指本次制作目录。宿主具备 `uv` 时优先 `uv run python`，否则使用 Python 3.10+。输出文件默认不覆盖。

```bash
python "$SKILL_DIR/scripts/review_board.py" init --title "人物替换制作" --output "$WORK_DIR/record.json"
python "$SKILL_DIR/scripts/review_board.py" validate --input "$WORK_DIR/record.json"
python "$SKILL_DIR/scripts/review_board.py" fingerprint --input "$WORK_DIR/record.json"
python "$SKILL_DIR/scripts/review_board.py" render --input "$WORK_DIR/record.json" --output-dir "$WORK_DIR/preview"
```

填写/修改制作记录后，用 `fingerprint` 得到候选与关口哈希，将实际检查绑定该值。更新要求或候选后，用 `reconcile --expected-revision N` 增加版本并移除失效采用；历史检查和意见保留为待复查。

```bash
python "$SKILL_DIR/scripts/review_board.py" reconcile --input "$WORK_DIR/record.json" --expected-revision 0 --output "$WORK_DIR/record-v1.json"
python "$SKILL_DIR/scripts/review_board.py" merge-feedback --input "$WORK_DIR/record-v1.json" --feedback "$WORK_DIR/review-feedback.json" --output "$WORK_DIR/record-v2.json"
fpl call visual.get_canvas --input '{"project_id":"<已授权项目 ID>"}'
fpl operations visual.apply_canvas_operations
```

`render` 输出 `index.html` 和六种中文文本看板，媒体只从制作记录目录内的显式相对路径复制。HTML 不访问 App，不保存凭据。`merge-feedback` 校验整份快照哈希、revision、候选/关口绑定，拒绝过期、重复或未知反馈。详细格式与命令见 [制作记录](references/record-format.md)。
