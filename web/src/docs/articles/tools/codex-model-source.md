<!-- docs: {"group":"tools","order":2,"title":"已移除的主机工具","lead":"空间占用与 Codex 模型源已移除，旧链接不再提供主机操作。","evidence":["web/src/features/tools/catalog.ts","backend/app/api.py","tests/test_tool_navigation.py","web/tests/cloud-control.test.tsx"]} -->

# 已移除的主机工具

空间占用与 Codex 模型源已从产品中移除。工具导航、收藏与最近使用中不再展示这两个工具；相应页面、主机操作接口和 SDK 方法也不再提供。

## 旧链接与记录

通过原工具链接访问时，只会进入现有工具目录，不会读取目录、磁盘容量或 Codex 配置。旧的收藏和使用记录按有效工具目录过滤；已有记录不会成为重新执行主机操作的入口。

可返回「工具导航」选择视频帧导出、视频下载等仍然提供的工具。完成标志是目录与侧栏都不再出现已移除的条目。

## 电脑上的配置与程序

移除产品功能不会修改电脑上的 Codex 配置，不恢复旧配置备份，也不会卸载已经安装的 GrandPerspective。相关程序与文件仍由其自身维护。

## 云控中的 Agent 工作台

管理员可以通过「云控 → Agent 工作台」阅读已绑定的本机 Agent 会话。工作台使用入口 `/agents`，与此前的 Codex 模型源工具具有不同职责，不提供这项已移除的配置修改操作。
