<!-- docs: {"group": "desktop", "order": 0, "title": "网站、Amadeus 与本地数据", "lead": "在浏览器中使用 Mac 后台服务、助手与本机管理。", "evidence": ["scripts/website/serve.py", "web/src/features/amadeus/PageProvider.tsx", "docs/operations/production-deployment.md"]} -->

# 网站、Amadeus 与本地 Agent

浏览器连接 Mac 上的后台网站服务。账号、作品、素材和任务保存在项目 `.runtime/`，关闭页面不会停止后台任务；云端仅托管程序并转发业务请求。

## 使用 Amadeus

1. 在「模型与智能体 → 编程智能体」确认已安装、登录且获当前账号用途授权的 CLI；连接状态应显示可用。
2. 从顶栏或工坊按钮打开 Amadeus 侧栏，新建对话并选择 Agent。窄屏中助手覆盖页面，可以关闭后继续编辑。
3. 查看当前页面、项目和未保存状态；使用控件选择工具添加明确引用。发送前应能看到选中对象的名称。
4. 按需加载 Skill、工具 API 和 MCP，描述目标与验收方式。提问和写入审批由用户明确处理。
5. 完成后核对作品内容与保存状态。遇到版本冲突先处理草稿，不重复提交未知结果的写入。

关闭侧栏或页面后重新打开，可恢复服务端会话和运行状态。模型提交中断后不会自动重提；先查看任务与日志，再决定后续动作。

## 外部 CLI、SDK 与 MCP

1. 在「账号设置 → API 密钥」创建所需权限与期限的密钥。需要再次复制时，在有效密钥的对应行点击「查看并复制」。
2. 在 Mac 运行 `fpl --profile codex connect --url http://127.0.0.1:9000`，按提示输入密钥。命令只输出账号和连接结果，不输出密钥。
3. 使用 `fpl --profile codex operations` 核对已登记操作；在编程智能体页面复制 MCP 配置，使用 `fpl --profile codex mcp serve`。
4. `fpl open director PROJECT_ID` 返回有权访问的作品链接。在浏览器打开并登录后应看到对应工程；该命令不强制切换已有编辑页面。

连接采用网站授权，不需要桌面配对。客户端配置必须保持私有，密钥撤销后后续调用立即按服务器权限拒绝。

## 本机与公网

管理员从本机头像菜单打开「本地与公网访问」，检查并控制公网隧道。公网入口隐藏此菜单，后端也拒绝公网管理员调用控制接口。新增本机会话目录、Codex 配置和磁盘管理同样只能在 Mac 本机网站入口完成；公网仍可查看已绑定来源和使用已授权 Agent。

网关配置由管理员按停机备份流程维护。Mac 离线时云端程序可能仍可加载，但业务调用显示离线，不能据此认为任务或数据已上传到云端。

## 相关阅读

- [工具 API、MCP 与 Skill](/apps/thought-workshop/official-knowledge-bases/general/documents/integrations)
- [SDK/API 使用指南](/apps/thought-workshop/official-knowledge-bases/general/documents/automation)
- [模型测试与后台任务](/apps/thought-workshop/official-knowledge-bases/general/documents/testing)
