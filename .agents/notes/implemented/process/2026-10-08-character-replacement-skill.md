# Agent Note: 人物与场景替换 Skill 和制作监督快照

Status: implemented

## Problem

原片人物替换需要跨镜头保持身份、表演、空间与剪辑节奏。任务完成、App 最终输出和用户验收是不同事实；缺少具体版本绑定会使新候选继承旧确认，散落的 review 也难以形成有证据的局部返修。

## Decision

官方自动化包提供可单独导入的 visual-character-replacement。流程继承上层模型与执行约束，使用本地版本化 JSON 保存镜头、输入快照、候选、检查、用户关口和返修；六份 App 文本及 HTML 对照页从同一记录生成。

本地标准库工具校验和渲染记录、合并反馈；反馈绑定整份快照及具体对象哈希。候选或要求变化使旧检查/确认待复查，采用只使用当前有效证据。HTML 不调用 App；正式同步通过已开放的接口，未开放的版本操作记录能力缺口，不绕过治理。

## Alternatives considered

- **只用原生任务状态** — 无需额外记录，但不能表达质量验收、证据和返修。
- **HTML 直接修改 App** — 反馈可立即落实，但需要新增服务、鉴权和公开接口，超出首版 Skill 与模板范围。
- **固定模型和四种参考输入** — 能复现单个案例，但限制上层策略和不同镜头实际需求。

## Consequences

- **收益**：素材职责、用户意见、Agent 检查和采用版本可追溯；代表镜头检查减少共同错误扩散。
- **代价与已知上限**：对照页是手动更新的快照；导出反馈需 Agent 合并。媒体 review 依赖宿主播放和试听能力，页面结论不能替代实际验收。本地记录由调用者串行维护，App 写入仍独立使用 CAS。
- 原生 App、HTTP/SDK 契约、数据库及模型配置不变，真实项目不自动导入。演示只包含文本数据，可分发 ZIP 不含真实媒体。

## Verification

- `uv run pytest -q tests/test_visual_replacement_skill.py`：28 项记录、反馈、关口、媒体内容绑定和 ZIP 导入检查通过；以 `FPL_SKILL_BROWSER_CHECK=1` 启用隔离浏览器回归，连同浏览器共 29 项通过。
- `uv run python skills/future-props-lab-automation/scripts/validate_skills.py` 验证官方包发现结构。
- Note 树、格式和归档封印检查使用 `node --import tsx scripts/verify-agent-note-{tree,format}.ts` 及 `scripts/checks/verify-archived-agent-notes.ts` 通过（沙箱内 `tsx` CLI 的 IPC 受限，运行相同检查入口）；`npm run check-docs-center-protected` 通过。
- 本地隔离预览验证候选筛选、证据定位、意见导出/合并、未导出意见保持、明暗主题、键盘和 390px 窄屏，以及缺失媒体和用户文本按纯文本展示。测试视频仅验证播放器行为；不调用供应商、不读取正式数据库。
