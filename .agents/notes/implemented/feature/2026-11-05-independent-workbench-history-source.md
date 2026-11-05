# Agent Note: 独立 Agents 接通历史会话源码预览

Status: implemented

## Problem

历史会话的文件预览已经登记到网关的公开契约。兼容站可以从本机项目读取文件，独立
Agents 只能保存会话及项目登记，生产容器没有 Mac 工作目录。缺少该路由时，独立
Agents 的启动契约检查失败。

## Decision

保留 `GET /v1/agent-workbench/sessions/{session_id}/source?path=…&line=…` 的浏览器
Session 接口及 `SourcePreview` 响应。Agents 按当前账号加载会话，以其持久工作目录
构建现有文件预览租约。Mac worker 只读已登记的本机目录或当前账号在 TOML 中明确获准
访问的相同目录。公网入口只使用 TOML 项目授权。Identity 在租约执行和回执阶段复核
管理员会话与解锁，Agents 在返回前复核会话和目录登记。

## Alternatives considered

给容器挂载本机项目会扩大读取范围，绕过 Mac worker 当前的目录授权和文件校验。
另设历史文件读取队列会重复现有的临时预览数据与回执流程。

## Consequences

兼容网站和独立入口都拒绝跨账号的会话、越界路径以及不可读的文件。文件正文只在当前
预览请求中传递，响应使用 `Cache-Control: no-store`。成功的队列回执持久化摘要，
失败的回执无正文。文件来自当前磁盘，单次预览最多读取 128 KiB 的 UTF-8 文本。

## Verification

- 独立 Agents 测试覆盖本机登记、TOML 公网授权、跨账号、解锁过期、读中撤权和越界。
- 兼容网站 API、服务打包、路由归属与生成契约在同一份隔离源码上复查。
