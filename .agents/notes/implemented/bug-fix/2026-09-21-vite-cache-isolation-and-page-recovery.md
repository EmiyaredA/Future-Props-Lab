# Agent Note: 开发依赖缓存隔离与页面恢复

Status: implemented

## Problem

桌面开发运行期间，普通 Web 或浏览器自动化可能使用并改写同一份 Vite 预构建缓存。现场曾出现 React 页面与磁盘预构建产物不同步，Radix Dialog 调用 React Hook 时拿到空 dispatcher，React 根卸载后只剩空白背景。冷缓存首次载入 PSD Worker 时，Vite 还会临时发现 `ag-psd`、替换依赖图并整页重载，导致正在进行的素材导入静默丢失。

## Decision

桌面开发每个运行实例、普通 Web 模式、Vitest 与 Playwright 分别使用独立 Vite 缓存；React 和 React DOM 去重到 Web 工作区解析源。对话框和 PSD Worker 的延迟入口依赖在服务启动时预构建，避免交互期间替换依赖图。应用入口增加模块加载恢复页，React 页面增加错误边界；重新加载和返回首页继续经过现有未保存保护。

相关桌面数据选择仍遵循[桌面开发默认复用本地 App 数据](../feature/2026-09-16-desktop-development-defaults-to-app-data.md)，缓存隔离不改变正式数据、迁移或更新边界。

## Alternatives considered

- **继续共享 `node_modules/.vite` 并在出错时手工删除缓存** — 不能避免并行服务再次覆盖运行中的依赖图，也无法保护正在编辑的页面。
- **只锁定 React 版本** — 安装的 React 与 React DOM 已一致；同版本的两份运行模块仍可能造成 Hook dispatcher 不一致。
- **只增加错误边界** — 能避免纯白页，但不能阻止依赖图重载中断导入或编辑状态。
- **禁用全部依赖预构建** — 会增加开发启动与首次加载成本，也不能提供比隔离缓存更清晰的并发所有权。

## Consequences

每个桌面开发实例会产生一个临时依赖缓存并在正常退出时清理，启动会多承担一次必要预构建。自动化不能再复用桌面进程的缓存。模块加载或组件渲染失败时用户可见错误摘要与恢复操作；恢复只导航或刷新，不自动重试写入、脚本或外部调用。Vite 配置或引导模块自身变更仍需正常退出后重新启动桌面开发。

## Risks

最初的 Radix Hook 现场无法由最小共享缓存探针稳定复现，因此不把单一缓存竞争声明为唯一成因。缓存所有权、依赖去重和恢复页共同消除已观察到的失效路径；后续若出现同类错误，应保留运行页面、预构建哈希和控制台堆栈继续定位。

## Verification

- `node web/scripts/check-vite-isolation.mjs` 同时运行两套 React/Dialog 图，验证隔离缓存下对话框可打开。
- `web/e2e/page-recovery.spec.ts` 和 `web/tests/shared/page-recovery.test.tsx` 覆盖模块加载、组件渲染失败及未保存导航保护。
- `web/e2e/live2d-workshop.spec.ts` 在全新 Playwright 缓存中通过三个流程；PSD Worker 的 `ag-psd` 在导入前完成预构建，导入期间不再整页刷新。
- 正式桌面界面只读检查确认页面恢复且新建角色对话框可打开；没有创建项目或写入正式数据。
