# Agent Note: 云控推荐常用开发应用

Status: implemented

## Problem

远程应用目录缺少常用开发工具的推荐入口。Codex 的安装包在 Mac 上可能显示为 ChatGPT，难以通过名称定位。

## Decision

Mac 辅助程序按 Bundle ID 推荐 Codex、DeepSeek Harness、Hermes、Google Chrome 和 OpenCode，并保留 Safari 与 VS Code。Codex 使用远控目录显示名。TextEdit 仍可从已安装应用中找到。顶部标签由本机管理员通过原有密码重验保存名单。

## Alternatives considered

按应用名称匹配会受本地化和包名影响。以 Bundle ID 匹配可沿用应用目录和窗口归属校验。

## Consequences

推荐项取自已安装且有可执行文件的应用。更新推荐规则需要替换 Mac 辅助程序，并复核屏幕录制和辅助功能授权。

## Verification

用签名后的辅助程序检查目录中的推荐标记和 Codex 显示名。复用云控授权、目录保存和远控信令的现有测试。
