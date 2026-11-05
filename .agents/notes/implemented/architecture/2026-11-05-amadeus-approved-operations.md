# Agent Note: Amadeus 批准的登记操作

Status: implemented

## Problem

用户确认 Amadeus 动作后，独立服务需要通过正式业务 API 执行登记操作。目标服务必须能区分获批内容与传输中改变的查询或正文。

## Decision

领取已批准动作后，从同版本的登记清单解析方法和目标。Identity 校验原 Session 及目标权限，签发绑定方法、路径、查询和 JSON 字节摘要的短期请求。目标服务在进入业务路由前验证完整摘要。传输未确认或目标返回服务错误时将动作结算为 unknown。

## Alternatives considered

转发浏览器 Cookie 会绕过服务间目标约束。仅签方法和路径不足以冻结写入内容。对不明确结果重试会重复已有副作用。

## Consequences

普通请求维持原鉴权和请求体处理，摘要验证只在指定的批准动作委派生效。目标服务继续检查资源归属和版本。Amadeus 不保存委派令牌。

## Verification

21 项定向测试通过。真实 Identity 与 Assets 测试确认批准写入，拒绝变更正文和查询，并在目标提交后丢失应答时留下 unknown。再次执行同一审批返回冲突。
