# Agent Note: 云控双栏工作台

Status: implemented

## Problem

云控需要在同一浏览器页面展示同一台 Mac 的桌面与 Agent 会话，并允许经显式授权从公网操作。

## Decision

云控在现有 FPL 进程中使用 guacd 回环隧道、账号 TOTP 与短时 Session 解锁。Agent 工作台保存独立的 FPL 发起会话，复用受限 CLI 传输。文件写入及固定命令由工作台审批后执行。

云控右栏依据工作台执行目录区分待配置、可选择和加载失败。本机缺少项目或可用 CLI 时显示就绪清单和设置入口。选择和发送校验当前有效项目及 CLI，已有会话继续沿用保存的上下文。

## Alternatives considered

独立 Guacamole 登录会增加一套账号和登录流程。RustDesk Web 客户端的关键运行代码在参考仓库缺失。原生终端会话沿用只读同步路径。

## Consequences

公网部署需要显式授权与 Mac 实机验收。项目配置、凭据与会话授权遵循 FPL 的单机边界。

## Verification

隔离测试覆盖验证码防重放、连接协议、会话恢复、项目路径与审批。真实设备与供应商验证依照云控部署文档执行。

Chromium 回归覆盖右栏打开设置、保存后刷新可用选项、先选 CLI 后选项目、首轮发送和刷新续聊。
