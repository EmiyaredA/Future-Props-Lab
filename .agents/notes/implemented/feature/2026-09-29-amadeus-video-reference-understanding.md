# Agent Note: Amadeus 视频参考帧进入多模态上下文

Status: implemented

## Problem

Amadeus 能发现画布和素材引用，但通用操作桥只处理有限大小的 JSON；视频抽帧导出为二进制文件，无法作为图像内容交给模型分析。模型调用日志和运行事件也不能因此保存整张帧图。

## Decision

Amadeus 通过会话范围的只读工具调用现有 Workspace 视频帧导出接口，抽取 4 或 9 帧联系表，在浏览器内压缩到单图 350 KiB 以内，并在模型调用期间作为临时图像输入。模型桥校验图像 MIME、Base64 和累计大小；调用日志与工具事件只保留图像 MIME、字节数和抽样时间。Skill 附件仍限于已加载的固定版本。SDK/CLI 继续复用现有抽帧操作，由素材 Skill 提供独立流程示例。

## Alternatives considered

- **提高通用操作结果上限或接受二进制响应** — 会扩大所有操作的上下文和错误面，且不能表达模型图像输入。
- **新建持久帧素材或重复建设抽帧接口** — 会增加素材生命周期和 API 契约，本需求只需要短暂的分析输入。

## Consequences

- **收益**：Agent 可按画面理解视频；跨 Workspace 素材仍由 asset store 校验；帧图不会写入运行事件或调用日志。
- **代价与已知上限**：每次最多 4 张联系表图像、单图 350 KiB；只提供静音画面抽样，超短视频需由调用方调整时间点。

## Verification

`uv run pytest tests/apps/amadeus/test_amadeus_video_reference.py tests/test_amadeus.py tests/contracts/test_automation_exports.py::test_video_frames_zip_grid_and_invalid_position`、Amadeus Web 单测、针对性 ESLint/Prettier、`npm run contracts:check` 与 Agent Note 树/格式检查通过。全量 Web 构建仍被仓库缺失的 `vendor/pi/packages/agent/src/harness/env/nodejs.ts` 阻断；全量 `tsc -b` 还报告视频剪辑目录及相关旧测试中的类型错误。
