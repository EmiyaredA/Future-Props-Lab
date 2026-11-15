# Agent Note: Mac 防休眠任务由 FPL 管理

Status: implemented

## Problem

Mac 的接电防休眠 LaunchAgent 仍以旧 remote-control 项目为工作目录，日志也在其 `.local/`。
FPL 接管公网入口后该任务仍独立运行，旧项目目录清理会影响后续登录时的任务启动。

## Decision

- `scripts/website/awake.py` 与 `npm run host:awake` 提供显式安装、启动、停止与状态查询。
- 保留 `com.futureprops.mac-host-awake` 标识及系统 `caffeinate -s` 策略，避免重复任务。
- 正式工作目录、日志、启动登记和原 plist 回退副本使用 `.runtime/host-awake/`。
- 安装只接管本 FPL 或相邻 remote-control 的防休眠定义；失败恢复原启动定义和原运行状态。
- 旧目录清理只做只读盘点；数据库、密钥、备份、恢复资料与尚未提交的源码保持原位。

## Alternatives considered

- **继续留在旧目录**：保留清理旧项目时的隐式运行依赖。
- **绑定云控连接或网站进程**：改变无人连接时仍保持远程可达的已有行为，超出迁移范围。
- **重命名任务标识**：需要协调两个登记的启停；沿用标识即可完成路径迁移。

## Consequences

任务运行不再依赖旧项目或 `.local/`，也无需业务服务重启。用户登录后显式安装的任务持续运行；
停止网站不会停止防休眠，stop 只影响当前登录会话。断电、合盖与 FileVault 启动解锁仍不保证远程可达。
安装回退只保存受影响的 plist，不复制业务数据；后续清理仍需单独确定数据保留与恢复需求。

## Verification

- `uv run pytest -q tests/integration/test_host_awake.py` 的四项隔离测试覆盖成功接管、重复安装、加载失败回退、异项目拒绝覆盖与缺失原定义时拒绝接管。
- `ruff check` 与 `ruff format --check` 检查新增脚本和测试。
- 正式迁移后核对 launchd 的 running 状态、caffeinate 参数、工作目录与日志路径，并核对系统电源断言。
