# Agent Note: Native session collection ownership

Status: implemented

## Problem

只读原生会话格式和附件适配仍位于旧通用能力目录，工作台投影与本机解析器共用一个带动态
重导出的父包，难以确认服务镜像是否意外包含主机读取能力。

## Decision

格式解析、目录发现、受限附件和本机 OpenCode 读取归 `studio/host/session_collection/`，
与已有采集 worker 和检查点日志共享明确的 Host 归属。历史批次和条目协议归 Workbench 的
`contracts/agent_workbench/session_history.py`，展示白名单与归一化归同所有者的 `activity.py`。
父包保持轻量，移除原动态转发，调用方直接导入契约或具体适配器。
镜像闭包继续拒绝 Host，服务只消费快照和原生回执；采集文件及检查点格式保持兼容。

## Alternatives considered

将采集器整体放入 Workbench 会把本机文件访问和服务端数据所有权混在一起。
保留动态重导出无法清楚区分纯协议与主机适配，因此删除旧包入口而不是增加转发层。

## Consequences

不修改原生文件、授权配置、账号绑定、字节检查点或执行授权。
技术指南与管理员导入包只同步代码入口路径；保留其他任务未提交的指南和界面改动。
CLI 连接配置及 Harness 仍在后续批次处理，不代表旧 `app` 已全部移除。

## Verification

- 当前共享工作区的会话、工作台及架构回归：110 passed、1 failed。失败是未提交的工作台
  接口清单新增操作尚未在独立服务匹配，未修改断言或过滤该接口来掩盖结果。
- 已提交基线加本批暂存改动的隔离副本中，发现、独立服务、历史迁入回归：4 passed，
  包含上述失败用例；测试使用临时数据与本机测试桩。
- 补充架构与源码打包检查：49 passed；23 个服务入口及 CLI 帮助在隔离源码闭包中通过。
- OpenAPI 和官方导入包 stale-check 通过；未执行实际 Docker 镜像构建。
