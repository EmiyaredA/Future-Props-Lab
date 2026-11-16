# Agent Note: 表格工坊接入当前独立部署

Status: implemented

## Problem

表格工坊的源码和镜像已完成，但当前环境的门户、路由、身份权限和管理服务仍不认识新应用。工作区与线上还有其他功能差异，直接整体替换会扩大此次发布范围。

## Decision

表格服务使用已验收的独立镜像和自有 SQLite。门户通过现有版本目录热发布。Identity、Gateway、Management 基于实际线上镜像文件系统构建最小差异，只增加表格所需的登记、权限、自动化资源定位及管理页面。公共契约在各自线上清单上合并表格部分，保留已有其他业务接口。

提交过的旧镜像携带历史 Docker Desktop 与 Compose 标签。派生镜像保留完整文件系统、依赖和必要运行参数，去除这些部署标签，让新的显式挂载和端口设置生效。服务构建编号使用现有隧道要求的 20 位十六进制摘要，镜像标签可以带发布用途前缀。

Mac 管理代码从当前冻结副本建立新副本，只补齐服务目录、Compose 选择、新迁移注册及发布辅助模块。正式代码、网页资源、配置与恢复材料全部位于 `.runtime/deployment/`，表格数据位于 `.runtime/independent-services/targets/spreadsheet/`。LaunchAgent 登记、已安装定义及实际工作目录保持一致。

切换通过现有 Agent 空闲门禁执行，使用明确的 switch、health、rollback 命令。主机服务先等待旧 LaunchAgent 完全卸载，再加载新定义。回环探针显式绕过本机代理，公网检查使用真实 HTTPS 地址。失败时回退，确认恢复健康后恢复任务入口。

## Alternatives considered

- 从当前工作区重建并替换全部既有服务：会同时发布本任务以外的接口及行为变化。
- 仅启动表格容器：门户、Identity、网关和管理服务仍缺少新应用的接线。
- 直接继承已提交镜像的全部元数据：历史 Desktop 端口标签会干扰新容器发布。

## Consequences

只有新表格库执行显式初始化，已有服务迁移账本不变。回退依赖旧镜像、受影响配置及其权限、启动定义和门户指针；因此只保存这些必要恢复材料。表格新增状态在回退时仍保留。

恢复材料在 `.runtime/deployment/recovery/spreadsheet-20261116/`。部署副本、各阶段计划和最终核验记录在 `.runtime/deployment/releases/spreadsheet-20261116/`。其他应用容器的启动时间保持不变。

## Verification

- 五个真实服务使用隔离账号和数据库，Chromium 从应用列表打开表格、新建、保存、重载均通过。
- 当前用户 Chrome 中从应用列表点击表格工坊，显示已登录的“我的工作簿”页面及新建、导入入口。
- 本机和真实公网的 `/ready`、表格当前构建清单一致，匿名工作簿 API 返回 401。
- 管理 worker 观测表格为 running / healthy，业务和管理公网隧道均为 ready。
- Amadeus 和 Agent Runtime 入口恢复 accepting；正式容器实际挂载不依赖仓库 `.local/`。
- 只有计划内的 Identity、Gateway、Management 三个既有组件重启；其他既有容器启动时间未变。
- 正式网页构建为 `dd59870329c4733aa13b`，最终镜像和实际核验结果记录于本机 `verification.json`。
