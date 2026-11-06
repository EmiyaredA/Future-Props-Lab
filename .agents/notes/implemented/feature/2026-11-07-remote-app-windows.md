# Agent Note: 云控按应用窗口远控

Status: implemented

## Problem

整屏共享增加画面传输范围，公网交互延迟也妨碍日常操作。部署管理员需要从已安装应用中明确选择可远控范围。

## Decision

兼容网站通过可信本机和近期密码重验管理 TOML 名单。WebRTC 握手票据按账号、浏览器会话和入口绑定，网站定时复核授权并关闭失效的 Host 连接。Mac 辅助程序按窗口采集画面，使用硬件 H.264 与 Pion WebRTC 传输，按窗口和进程核对输入。公网可使用自托管 TURN。

## Alternatives considered

在 VNC 画面上加应用快捷入口仍传整屏。Wisp 的逐窗口体验与 RelayRemote 的浏览器传输可分别参考，FPL 需要接入自己的管理员会话与本机配置流程。

## Consequences

此功能依赖登录且解锁的 Mac、屏幕录制和辅助功能权限。应用沿用该 Mac 账号的权限。生产切换由配置显式启用，要求先完成 Chrome、文本编辑与公网延迟验收。

独立 Remote 保留远程应用 HTTP 契约及已禁用时的响应。预检拒绝在开启远程应用或 Happier 网站接入时接管业务入口。

## Verification

自动化覆盖名单修改与冲突、浏览器会话隔离和公网权限。真实应用与网络验收按云控参考文档执行。
