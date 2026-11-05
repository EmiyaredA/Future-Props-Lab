# Agent Note: 工作台容器门禁的原生执行与就绪检查

Status: implemented

## Problem

精简 Docker 门禁会启动工作台及原生采集器。工作台自身的就绪检查还需要原生执行 worker，状态聚合也会如实报告精简拓扑缺少的 Agent Runtime。浏览器脚本曾从应用目录寻找工作台，当前该入口由云控导航承载。

## Decision

门禁叠加工作台的执行 Compose 配置，并使用独立凭据、配置和状态目录启动原生采集与执行 worker。管理观测器持续报告真实容器状态。聚合检查要求工作台仅因缺少 Agent Runtime 降级，并在停止和恢复门户时核对其他服务的启动时间。Chromium 从目录展开演示工坊的未部署状态，经导航进入云控，再用同一会话直接打开独立工作台。

## Alternatives considered

- 在精简拓扑部署 Agent Runtime 及相关原生组件。完整 Compose 验收已经覆盖这条路径。精简拓扑用来验证缺少依赖时的真实状态和其余服务的独立恢复。

## Consequences

门禁同时覆盖工作台自身就绪、精简环境依赖缺失、门户独立替换和浏览器会话复用。完整 Compose 仍负责验证所有登记服务同时运行。

## Verification

使用固定候选 `e25a2e0e` 的七个镜像运行 `npm run services:test:agents -- --browser …` 所对应的 Python 命令。隔离项目 `fpl-isolated-agents-53236885cf` 的 14 项检查通过。Python Ruff 检查和 Node 语法检查通过。
