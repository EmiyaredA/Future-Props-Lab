# 开发交付说明

## 交付基线

- 目录职责以 `docs/architecture/project-layout.md` 为唯一完整索引。
- 公共 HTTP/SSE 形状以生成 OpenAPI 和 `docs/reference/api.md` 为准。
- 合并前执行 `npm test`、`npm run lint`、`npm run format:check`、
  `npm run contracts:check`、`npm run build` 和 `npm run test:e2e`。
- 生产仍限定为单进程、单 SQLite；数据修复只能通过正式 `/v1` API。

## 已知仓库债务

`docs/assets/` 中的大型演示素材和 `galgame_performance_upgrade.py`、`galgame_runaway_*` 等内容专用
脚本用于可复现的演示内容制作，不属于生产运行依赖。本轮没有迁移这些素材、引入 Git LFS、改写
Git 历史或搬迁脚本。后续若执行仓库瘦身，应作为独立变更评估克隆方式、历史兼容和素材发布位置。

内容专用脚本不得包含真实密钥；Management API Key 只能通过短期进程环境变量传入。脚本内的本机
默认素材路径和演示项目 ID 不是通用生产配置，运行前必须显式确认参数和目标 Workspace。
