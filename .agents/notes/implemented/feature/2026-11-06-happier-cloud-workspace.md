# Agent Note: 云控 Happier 工作区

Status: implemented

## Problem

云控旧工作台和 Happier 的 CLI 会话、审批、文件与终端界面分别维护。云控需要复用完整工作区，同时继续受 FPL 登录和密码解锁约束。

## Decision

配置 Happier 后，云控在独立全宽视图嵌入原生 Web。固定版本构建仅调整原生右侧文件栏的首次打开默认值。FPL Session 换取单次启动凭证和独立浏览器 Cookie。专用单客户端 OIDC 使用 FPL 管理员 ID 签发短期身份断言，入口按原会话复核网页、API 和实时连接。CLI 使用受限 Runner 和私有 Relay 入口。

## Alternatives considered

复刻 Happier 各组件需要同步其会话协议、模型选项和每种 CLI 的能力。直接公开 Relay 会绕开 FPL 云控解锁与撤权。

## Consequences

Happier 使用独立同站 HTTPS 域名。Relay 自己持久化并能读取会话，FPL 历史仍从原工作台读取。启动凭证、授权码和浏览器入口签名只在网站进程中有效，网站重启后需重新打开入口。

## Verification

`tests/apps/remote_desktop/test_happier_cloud.py` 覆盖真实 FPL 测试会话、单次兑换、OIDC PKCE 与注销撤权。前端用例验证切换时保持同一个 iframe。真实 Happier Relay 的隔离联调验证了原生账户建立、Socket.IO 认证与 FPL 注销后的实时连接关闭。完整环境放行步骤见[部署指南](../../../../docs/operations/happier.md)。
