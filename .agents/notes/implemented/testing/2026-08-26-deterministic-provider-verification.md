# Agent Note: 供应商行为使用确定性适配器测试

Status: implemented

## Problem

真实模型调用有费用、网络和供应商状态波动，不能作为稳定 CI 证据。

## Decision

供应商差异在 adapter 边界归一化；单元/API/流程测试使用确定性适配器、Mock 响应和本地演示运行时，不用真实供应商调用替代自动化测试。

## Alternatives considered

- **CI 直接调用真实供应商** — 受凭证、额度、网络和结果漂移影响。
- **完全不测试供应商差异** — 会把协议错误推迟到人工验收。

## Consequences

- **收益**：测试可重复且不产生费用。
- **代价与上限**：真实凭证、计费和外网行为需要另做交付验收。

## Verification

运行后端、provider adapter 和 demo runtime 测试。

