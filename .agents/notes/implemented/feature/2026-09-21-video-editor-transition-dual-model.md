# Agent Note: 视频剪辑转场双模型（接缝 vs 片段）

Status: implemented

相关：[`2026-09-21-video-editor-transitions.md`](./2026-09-21-video-editor-transitions.md)

## Problem

v1 把接缝与片段边缘都放进 `document.transitions`，导致时间线标记混杂、无法右键编辑接缝、选中转场会清空片段以致无法设置入/出场，用户也无法建立「两种可叠加转场」的清晰心智模型。

## Decision

片段自身转场挂在 Clip 的 `transitionIn` / `transitionOut`，效果库与接缝对齐（含 direction、easing；音频仍可用 `audio-crossfade`）。`document.transitions` **只保留** `placement: "between"` 接缝转场。

加载与写入前通过 `normalize_legacy_edge_transitions` 把历史 `placement=in|out` 迁到对应 Clip 边字段并删掉集合条目。接缝转场窗口以切点为中心：`[seam − D/2, seam + D/2)`。

**闪白（flash）** 与叠化不同：前半只播出场画面并升白（闪白出），后半只播入场画面且入场本地时间从 `0` 起算并降白（闪白入），避免入场素材在切点后再从开头重播一遍。交叉叠化 / 擦除等仍在整窗内双轨混合；非闪白转场结束后，入场本地时间按「窗起点起连续前进」衔接，避免手柄段跳变。

预览（`previewTransitions.ts`）与导出 evaluator 同序：接缝窗内按上述规则合成，并可再叠 Clip 边 `transitionIn` / `transitionOut`。

Web：空接缝显示可点「+」、接缝标记可右键编辑/删除；片段右键可添加/编辑入出场；**片段块两端按时长绘制入/出场转场色带**（可点开编辑）；转场面板分区操作接缝与片段边；属性面板提供片段入/出场启用、取消与时长（见 [`2026-09-22-video-editor-inspector-clip-transitions.md`](./2026-09-22-video-editor-inspector-clip-transitions.md)）；接缝胶囊宽度按 `durationUs × zoom` 并以切点居中。

## Alternatives considered

- **继续用统一 `transitions[]` 的 in/out/between** — 交互与选中态纠缠，右键与空接缝命中难做清，因此放弃。
- **接缝改回只存在于 Clip 边字段** — 无法表达可独立选中的接缝对象与双 Clip 关系，因此放弃。
- **闪白整窗双轨叠化到白** — 观感像「糊白叠化」且入场易在切点后从头再播，因此改为前半闪出 / 后半闪入。
- **闪白只占切点前半窗** — 入场没有对称的闪白入，切点后立刻干切，因此放弃。

## Consequences

- **收益**：接缝与片段转场可同时存在、分别编辑；右键与空接缝命中补齐；旧项目经归一化兼容。
- **代价与已知上限**：节目监视器仍是 DOM/CSS 近似；历史 in/out 在首次读取/写入时迁移，未落盘前 DB 仍可能残留旧形状。成片导出必须按 evaluator 的 clip-local 时间取帧（含定格与窗后连续性），不能假定顺序 `next()` 与时间线一一对应；见 [`../bug-fix/2026-09-22-video-editor-export-transition-local-time.md`](../bug-fix/2026-09-22-video-editor-export-transition-local-time.md)。

## Verification

- `uv run pytest -q tests/test_video_editor_transitions.py`
- `npm run test --workspace web -- tests/video-editor-transitions.test.tsx tests/video-editor-preview-transitions.test.ts`
- `npm run contracts:check`
- `npm run verify-notes`
