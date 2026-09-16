# Agent Note: 桌面开发默认复用本地 App 数据

Status: implemented

## Problem

桌面热加载默认使用独立开发目录，开发时看不到本地 App 已有的账号、配置、作品和素材，
需要额外切换启动方式才能验证真实本地数据上的行为。

## Decision

`npm run dev:desktop` 默认进入正式 App 数据目录 `~/Library/Application Support/Future Props Lab/`，
复用已有 live 启动器的实例锁、正常退出、首次完整备份、配置快照和迁移校验。`npm run dev:desktop:live`
保留为兼容别名；需要数据隔离时使用 `npm run dev:desktop:isolated`，继续使用
`Future Props Lab Development/`。正式数据入口不绕过未保存保护，也不自动执行待执行迁移。

## Alternatives considered

- **继续要求显式 live 参数** — 安全边界更保守，但无法满足日常开发直接验证本地 App 数据的需求，且每次启动都增加额外心智负担。
- **让默认开发目录复制正式数据** — 能同时保留目录隔离和真实数据，但复制数据库、素材和加密配置会引入同步、空间和密钥配对风险，也不符合不复制或合并运行数据的约束。

## Consequences

- **收益**：日常 `npm run dev:desktop` 直接看到本地 App 的账号、配置、作品和素材；已有 live 保护继续生效。
- **代价与上限**：默认开发操作会作用于正式本地数据，启动时可能要求退出已安装 App；临时烟测和不希望触碰本地数据的开发必须显式使用隔离入口。

## Verification

已核对入口脚本、桌面开发文档与项目规则保持一致；现有 `--live` 路径继续执行数据锁、停机备份、配置校验和迁移 checksum 校验。

相关历史决定已归档：[桌面 live 开发使用受控正式数据](../../archived/feature/2026-09-14-live-development-protected-data.md)。
