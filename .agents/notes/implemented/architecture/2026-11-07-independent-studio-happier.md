# Agent Note: 独立 Studio 复用本机 Happier

Status: implemented

## Problem

单套独立 Studio 要替换兼容网站时，网关尚不能接收本机 HTTPS 上的 Happier 启动，正式配置因此不能通过预检。公网 Agents 使用自己的隧道和 Relay。

## Decision

同一个 Studio 网关提供 HTTP、公网 HTTPS 上游与本机 HTTPS 入口。Gateway 管理一次性票据、浏览器授权及 Relay 转发，两种网站装配共用实现。独立装配以启动操作的 Identity 签名断言绑定会话，并用服务凭据复核解锁、会话状态和撤权。只有专用的本机 HTTPS 监听器有权接收对应来源。Gateway 持有的 Identity 断言在 Happier Cookie 中加密。

## Alternatives considered

单独运行兼容网站只为了 Happier 会重复业务入口和持久状态。把本机 Relay 直接交给浏览器会绕开 FPL 的密码复核和撤权。

## Consequences

正式配置增加 Gateway TLS 文件和两个回环端口的最小投影。Studio 共用一个构建，公网 Agents Relay 独立运行。网关重启后从 Studio 重新领取 Happier 授权。

## Verification

集成测试覆盖密码重验、票据单次使用和 Identity 注销撤权。容器使用的 TLS 配置和 Relay 入口见 [Happier 部署与切换](../../../../docs/operations/happier.md)。
