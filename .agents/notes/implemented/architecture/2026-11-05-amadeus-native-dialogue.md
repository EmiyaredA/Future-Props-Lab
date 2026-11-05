# Agent Note: Amadeus 独立 CLI 对话

Status: implemented

## Problem

独立 Amadeus 需要执行原有 Code Agent 对话，保持账号历史、提问、审批、继续和取消，并从独立门户打开侧栏。

## Decision

Amadeus 保存归属、冻结连接签名和运行事件。Mac worker 只读取登记的 CLI 配置及专用档案，经独立回环领取任务。工具与事件由 Amadeus 校验租约及当前授权，原断言只保留在进程内。工具定义与提示组装由兼容站和独立服务共用。门户装配同一侧栏，详情及历史布局按侧栏容器宽度决定。

## Alternatives considered

在容器执行宿主 CLI 会丢失受管的本机连接和专用档案。以浏览器视口决定侧栏布局会让历史与执行详情挤压实际聊天空间。

## Consequences

公开启动核对全部 34 项操作与发布契约，就绪要求可用的对话 worker。外部 CLI 路径不进入公开执行记录。未确认运行由持久记录保存部分结果，后续需要用户明确继续。

## Verification

定向测试通过。隔离五容器与 Mac 实际运行 Codex App Server 协议夹具，验证固定工具、原生脚本、重启及浏览器 1440、768 和 390 像素下的历史读回。生产账号、数据和模型供应商未用于该验收。
