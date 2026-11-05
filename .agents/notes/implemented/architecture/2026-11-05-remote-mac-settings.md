# Agent Note: Remote 本机云控设置协调器

Status: implemented

## Problem

独立 Remote 的公开设置接口需要保留受信任本机入口和配置修订语义。Docker 内的进程只拥有自己的配置与持久数据。

## Decision

Remote 按同账号同路径授权短期 Mac 租约，浏览器授权只存在于等待响应的请求内。本机 worker 在权威 TOML 的修订锁内再次核验原会话，原子写入配置，再提交 Identity 和 Remote 的独立只读投影。Mac 记录执行意图与结果，Remote 按租约保存精确回执。

## Alternatives considered

将部署 TOML 直接挂载到 Remote 会扩大容器的配置权限。让网关接管本机业务写入会混淆入口和配置归属。

## Consequences

Remote 需要 0003 迁移。配置协调器通过专用原生回环入口运行，部署需挂载仅含自身字段的目录和公共提交记录。公网设置调用返回拒绝，旧版本保存返回冲突。

## Verification

隔离测试覆盖本机读写、原子生效、真实授权、错误入口、公开启用的验证器门禁、陈旧版本、写入前撤权和丢失回执重放。
