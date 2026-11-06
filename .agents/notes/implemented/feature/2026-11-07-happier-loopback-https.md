# Agent Note: Happier 独立本机 HTTPS 入口

Status: implemented

## Problem

已有公网 Studio 监听器启用了远程桌面限制。直接重用该来源启用 Happier 会改变公网入口的访问策略。

## Decision

可为 Happier 配置同站的两个 .localhost HTTPS 来源和证书。网站装配复用同一个 FPL 应用，并在独立回环 socket 上提供 Studio 入口。只有该监听端口可以授予本机 Happier 会话标记。该标记仅用于 Agent 解锁，公网监听器继续使用原策略。

## Alternatives considered

重用现有公网来源要求取消其桌面限制。另起一套网站进程会与正在运行的网站争用数据锁，并重复启动业务执行器。

## Consequences

本机浏览器需要使用配置的 HTTPS 地址和相应的证书信任。现有 FPL 会话、Happier 会话和 Runner 凭据各自保留原有边界。

## Verification

隔离测试覆盖公网 socket 不能取得本机 Happier 标记。浏览器和回环端口的部署验证见 [Happier 部署与切换](../../../../docs/operations/happier.md)。
