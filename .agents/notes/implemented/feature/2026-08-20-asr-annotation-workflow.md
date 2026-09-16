# Agent Note: ASR 结果通过录音标注工作流沉淀

Status: implemented

## Problem

识别结果既需要模型测试，也需要分段、说话人、语言和导出能力。

## Decision

文件语音识别提供模型结果，录音标注项目负责分段、说话人、情绪、翻译和 JSON/SRT 导出；Galgame 配音流程通过正式标注或导入边界消费结果。

## Alternatives considered

- **只在模型测试页展示文本** — 不能支持可编辑片段和导出。
- **让供应商响应直接决定领域模型** — 会把供应商事件形状泄漏到业务 API。

## Consequences

- **收益**：模型适配与编辑领域分离。
- **代价与上限**：需要保存输入副本、分段和导入状态。

## Verification

运行模型测试转写、音频标注和导出测试。

