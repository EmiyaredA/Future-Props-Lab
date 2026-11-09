# Agent Note: Amadeus 模型推理强度与摘要

Status: implemented

## Problem

Amadeus 的模型列表只传名称和 ID，丢掉模型特有的推理档位。CLI 提供的推理摘要也没有独立展示位置。

## Decision

参照 Happier `2aeb139d391b` 的 Codex App Server、Claude 模型策略和 Pi 模型目录，将可用档位接入模型目录。Codex 以 App Server 的目录为准，Claude Code 结合安装探测与已知模型档位，Pi 依据 RPC 模型的推理标记。用户选项随每轮执行快照传入两套装配，使用原生参数。Codex 的已完成摘要作为独立会话事件保存。

## Alternatives considered

整套搬入 Happier 的执行配置会同时带入终端、权限和会话控制。Amadeus 继续使用 FPL 账号、限定工具和审批体系，仅把已接通的模型能力暴露给用户。

## Consequences

切换模型重新使用默认推理强度，恢复会话时按最近一轮和当前目录恢复可用设置。推理摘要独立于正式回复、工具记录和后续提示。OpenCode 的变体、Harness 的 ACP 配置，以及快档、额度和原生会话控制各需独立的能力来源与执行契约。

## Verification

使用隔离账号和假 CLI 验证 Codex、Claude Code、Pi 的目录与执行参数，检查独立 Mac Worker 的运行快照。浏览器用例检查推理选择、摘要折叠和工坊侧栏恢复。
