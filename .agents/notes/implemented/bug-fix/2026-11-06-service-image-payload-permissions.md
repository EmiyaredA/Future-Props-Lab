# Agent Note: 独立服务镜像的文件权限

Status: implemented

## Problem

使用 `umask 077` 构建时，Docker 会保留上下文中生成文件的权限。镜像在构建阶段以 root 运行入口检查，通过后在 Compose 中以数据目录的非 root UID 启动，无法读取入口脚本或导入 Python 包。

## Decision

打包器将列入清单的目录设为 0755、文件设为 0644，并把这两个模式纳入发布版本摘要。代码、契约和前端构建通过同一规则落盘。外层构建目录和运行期挂载文件仍由各自的创建与授权流程控制。

## Alternatives considered

- 要求部署操作者改变 umask。这个做法会把镜像是否可启动交给外部环境，也无法让发布版本区分权限不同的打包结果。
- 逐镜像在 Dockerfile 中修复权限。共用打包入口可以统一处理独立应用、网关和管理端。

## Consequences

同一份清单可在不同 umask 下重建成同一发布版本。首次使用该规则时需重建镜像，新版本摘要与旧镜像标签分开。

## Verification

回归在 `umask 077` 下准备 Amadeus 镜像，检查入口、源码及目录模式，再以普通 umask 重建并核对标签。独立 Docker 演练使用非 root UID、只读根文件系统与隔离状态目录执行迁移。
