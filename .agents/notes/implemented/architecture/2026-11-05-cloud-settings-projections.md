# Agent Note: 云控配置的归属投影与发布

Status: implemented

## Problem

云控设置同时修改 Identity 的访问策略与 Remote 的显示信息。两种配置需要从 Mac 上的权威 TOML 发布，业务服务只能读取自己的字段。

## Decision

Mac 先生成并同步两个不可变的、按 SHA256 寻址的 TOML 投影，再原子替换只包含摘要的公共提交记录。读方读取一次提交记录并验证自己目录里的版本、摘要和字段。Remote 只获得主机标签。Identity 只获得账号和访问策略。

## Alternatives considered

直接挂载完整配置会把与服务无关的凭据提供给容器。逐个替换活动文件会在更新中暴露一半新策略与一半旧配置。

## Consequences

投影目录、提交目录与 Mac 权威配置各自独立。读方遇到未提交、损坏或归属不符的配置时拒绝读取。

## Verification

定向测试覆盖准备和提交之间读到旧版本、提交后读到新版本、越权字段和摘要不符拒绝，以及 VNC 密码不进入任何投影。
