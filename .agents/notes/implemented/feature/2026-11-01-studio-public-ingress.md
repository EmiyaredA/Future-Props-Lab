# Agent Note: 桌面同进程 Studio 公网入口

Status: implemented

## Problem

现有 FPL 已拥有账号、工作区与创作流程，额外工作台和 GitHub 登录重复维护身份。直接转发桌面私有端口会越过 Electron 启动凭据及 SDK 配对边界，另起正式后端则重复运行任务执行器。

## Decision

`[remote_web]` 默认关闭。桌面入口在同一个 Uvicorn Server 中增加独立回环 socket，按真实绑定地址而非请求头区分入口，共享唯一数据库与生命周期。公网只使用正式构建，不公开 Vite；使用原账号浏览器 Session，继续执行 CSRF 与工作区权限。网络基础设施通过注入的鉴权回调使用既有账号原语，不导入业务数据库。

公网移除伪造的桌面／转发身份头，拒绝桌面初始化、配对、私有 UI、原始 API 文档和注册。Host 精确匹配，所有写请求和 WebSocket 必须携带精确 HTTPS Origin。认证 Cookie 在公网响应中增加 Secure，维持 host-only 和 Session HttpOnly；桌面本地行为不变。SSE／WebSocket 不缓存、不重放，任务由原状态机管理。

## Alternatives considered

- 直接给反向代理注入桌面 token：会把私有启动通道扩展到公网，还需逐个封锁敏感桌面接口。
- 单独生产后端读取桌面 SQLite：复制 Runner／恢复执行语义，违反单进程部署约束。
- 新建账号或 GitHub 网关：重复已有身份、治理与恢复流程。

## Consequences

公网依赖 Mac 和 FPL 进程在线；同进程接口不意味着浏览器获得 Electron 系统权限。公网当前关闭注册，管理员继续使用原账号治理。两个入口共享数据库锁和现有配额；公网认证多一次短会话校验，不持有长事务转发媒体。云端 TLS 终止仍属于在线流量信任边界。

## Verification

- 账号、桌面、配置与安全相关回归 43 项通过；新增跨账号、流断线与实时／任务状态机测试使用隔离数据和模拟供应商。
- 架构检查 47 项通过，1 项既有跨 feature 私有导入失败，涉及 HomeHeroPet 和 VideoDownloaderPage，本轮未修改这些文件。
- Web 类型检查及正式打包完成；既有 Galgame CSS 325.6 KiB 超过 324.8 KiB 门禁，未放宽预算。
- 真实桌面更新先完成 54GB 一致性停机备份，正式数据的既有 0115 迁移核验通过，无新数据库迁移。
- 公网 TLS 1.3、HTTP 308 与离线 503 已实测；本人原账号及另一设备的动画验收单独记录，不以自动测试替代。
