# 网站开发与正式数据隔离

使用 npm run dev 启动 Vite 与 9001 开发后端，数据位于 .local/dev-runtime/。正式网站使用项目 .runtime/ 与 backend/config.toml，通过 npm start 或用户级后台服务运行。自动测试不得读取正式配置或数据。后端更新需显式停止和重启；配置与迁移变更先制作完整停机快照。详见[生产部署](production-deployment.md)。
