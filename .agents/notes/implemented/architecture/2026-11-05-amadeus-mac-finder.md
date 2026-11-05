# Agent Note: Amadeus 独立 Finder 和脚本能力探测

Status: implemented

## Problem

独立 Amadeus 需要保持本机浏览器打开对话目录及脚本沙箱能力发现，容器无法直接访问 macOS。

## Decision

Amadeus 在校验本机浏览器和对话归属后，向自己的持久队列交付精确对话 ID。只在请求内存保存原断言，Mac worker 领取租约后从专用回环通道复核授权。执行器从部署指定的 Amadeus 状态根解析目录，并只调用系统文件管理器。能力发现使用最近一次认证轮询上报的实际沙箱探测。服务恢复时未领取任务失败，已领取未确认任务进入 unknown，原 worker 仍可提交精确回执。

## Alternatives considered

向 worker 传入客户端路径会扩大宿主文件权限。容器内执行 Finder 或探测容器沙箱不能反映 Mac 的实际能力。

## Consequences

公网会话不能触发 Finder。回执响应丢失时可重复发送原回执，原动作只执行一次。状态卷新增原生任务回执表，不保存浏览器令牌。

## Verification

79 项定向测试通过，1 项跳过。隔离四容器走真实网关和独立 Mac worker，核验本机沙箱探测、Finder 命令交付、嵌套 Skill 文件和重启读回。Finder 启动由测试替身记录参数；权限撤销与丢失回执由协议测试覆盖。
