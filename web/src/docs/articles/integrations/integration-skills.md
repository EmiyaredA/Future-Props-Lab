<!-- docs: {"group":"integrations","order":4,"title":"Skill 导入、版本与启停","lead":"用不可变版本管理 Skill 内容包。","evidence":["web/src/features/integrations/IntegrationCenterPage.tsx","web/src/features/integrations/ToolApiPanel.tsx","web/src/features/integrations/McpPanel.tsx","web/src/features/integrations/SkillPanel.tsx"]} -->

# Skill 导入、版本与启停

<!-- prerequisites -->

面向空间所有者或平台管理员。先确认目标工作空间和资源来源；普通成员不能管理或验证集成。不要在示例输入中放入真实凭证。

用不可变版本管理 Skill 内容包。

## 准备 ZIP

导入包最大 10 MiB，必须包含根目录的 SKILL.md。不要把它放在额外顶层文件夹里，也不要打包凭证或无关运行数据。

![Skill ZIP 导入对话框](/docs/integration-skill-form.jpg "真实界面 · 隔离演示数据；合成素材或本机确定性响应，不代表外部模型效果。")

## 上传与管理版本

1. 进入“集成中心 → Skill”，选择导入。
2. 点击“选择文件”，检查选中的 ZIP。
3. 选择是否“导入后启用”，点击“上传并校验”。
4. 在详情查看版本列表，按需下载版本或追加新版本。

## 更新与启停

已有版本保持不可变；修改内容后添加新版本。启停调整当前目录条目的可用状态，不修改历史版本里的文件。发生版本冲突时刷新列表再操作，不覆盖其他窗口刚保存的配置。
