# Agent Note: ZEALMAN 参考素材使用固定 API 参数提交

Status: implemented

## Problem

应用任务快照保存了参考素材，供应商执行却可能使用空白文件，导致角色身份、动作和背景无法与已采用参考对齐。仅核对应用内素材 ID、上传成功或任务完成状态，不能证明实际生成输入正确。

本次上游历史显示，原有提交路径中的三张图片被替换为 `zealman-blank-image.png`，视频被替换为 `zealman-blank-video.mp4`。服务公开 API 文档说明：`source=api` 的 MiniMax 多参考调用缺少对应 `input_values` 文件参数时，服务使用空白占位，即使调用方已修改 `workflow_template` 中的加载节点。

## Decision

- U17、U06 共用的供应商适配器提交 `workflow_id`、`source=api` 与 `input_values`，不再下载、修改或提交整张工作流。
- `ref_image_0`、`ref_image_1`、`ref_image_2` 分别对应提示词图1、图2、图3；视频和音频各自从零编号。保留调用者数组顺序，不排序、不改名、不用节点数字替代，不填入模板示例或伪造音频。
- 图片、视频、音频先上传到同一个已配置服务，返回的文件名直接成为对应固定键的值。提示词显式通过 `prompt` 传入。
- U17 使用 `aspect_ratio`、`megapixels`、时长 `value` 与放大倍率 `value_2`；U06 使用服务公开别名 `param_4`、`param_5` 表达宽高，保留任务快照中的 `seed`，时长同样使用 `value`。
- 提交前校验参考类型、数量与非空文件名。未选槽位不提交文件参数，由上游按其 API 规则占位，不引入模板示例。提交中断继续安全失败，不自动重提。

这取代 [ZEALMAN 视频模型测试接入](../feature/2026-10-16-zealman-video-testing.md) 中通过工作流节点副本传参的实现；[视觉创作工坊接入](../feature/2026-10-16-visual-zealman-generation.md) 与模型测试自动共用此次协议修复。

## Alternatives considered

- **继续只提交修改后的工作流** — 无法满足服务对 API 模式显式文件参数的要求，已有执行历史证明会进入空白占位。
- **把来源伪装为快捷生成以避开占位** — 依赖另一条产品入口的特殊规则，偏离用户提供的固定 API 契约，因此不采用。

## Consequences

- 应用内参考编号、上传文件与供应商固定键保持一一对应，不依赖 ComfyUI 内部节点 ID 或排列。
- 不改变公共 REST/SSE、数据库、素材或任务恢复规则。已有错误成片不会自动重生成。
- 上游的 API 参数名属于适配器契约；发生变化时需重新核对。空白占位并不构成用户要求的有效参考。
- 修复后的真实动态画面仍需单独验收；模拟请求通过不代表画风、动作或抠像质量已通过。

## Verification

- `tests/apps/visual_workshop/test_zealman_video.py` 直接断言 HTTP JSON 中三张图片、一段视频、空音频、提示词及所有 U17 参数的固定键和值；覆盖全部槽位、不同输入顺序、空文件名、U06 参数及提交超时不重试。
- `tests/apps/visual_workshop/test_visual_zealman.py` 在隔离数据库中贯通正式任务、素材解析、上传映射、真实适配器和模拟 HTTP 传输，核对图片、音频、视频对应文件及恢复不重复提交。
- 本次只读取上游已有执行历史和公开 API 文档，不提交真实模型任务。
- 合并运行相关供应商、工坊和架构检查时，67 项通过；唯一失败是 `HomeHeroPet.tsx` 在当前 HEAD 已存在的跨 feature 内部导入，与本次修改无关。修改文件的 Ruff、格式及 Agent Note 检查通过，文档中心受保护路径未变化。
