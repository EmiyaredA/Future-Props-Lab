<!-- docs: {"group":"tools","order":2,"title":"本机 Codex 模型源","lead":"在桌面版查看与切换本机模型源，保留可恢复的配置备份。","evidence":["web/src/features/tools/CodexModelSourcePage.tsx","backend/app/tool_navigation/codex_source_routes.py","backend/app/tool_navigation/codex_source.py","tests/test_codex_source.py"]} -->

# 本机 Codex 模型源

从「工具导航 → Codex 模型源」打开。该工具只向 macOS 桌面版的平台管理员开放，使用登录 Session；管理 API Key 和本地 Agent 通道不能调用它。

## 查看与修改

页面读取运行环境的 `CODEX_HOME/config.toml`，默认位于用户目录下 `.codex/config.toml`。选择 OpenAI 官方源或兼容 Responses API 的自定义源，填写基础地址与模型 ID，再检查并保存。

工具管理固定的 `fpl_custom` 供应商配置，保留无关设置。它不终止 Codex 进程，也不直接修改正在运行的桌面端内部状态。

## 密钥和生效方式

自定义源的密钥通过环境变量名引用，不在页面输入或保存 API Key 明文。该环境变量必须由启动 Codex 的进程提供；仅填写变量名称不会自动创建密钥。

保存后按页面提示重启 Codex；已有会话还可能需要重新选择模型。端点和模型是否可用取决于实际服务及权限，不由配置保存成功保证。

## 备份、恢复与冲突

首次写入前保存原始配置备份。恢复原始文件会覆盖之后的手工修改，操作前先检查提示并保留自己需要的内容。

配置按文件修订值检测并发；其他程序改动后，旧页面保存或恢复会被拒绝。重新读取当前状态、核对差异后再操作，不反复提交旧值。
