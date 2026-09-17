<!-- docs: {"componentSyntax":true,"group":"start","order":0,"title":"文档首页与阅读路径","lead":"从配置第一个模型到完成一份创作，按你的目标开始阅读。","evidence":["web/src/app","web/src/features/accounts","web/src/features/models"]} -->

# 欢迎使用未来道具研究所

这里是平台的使用说明。第一次使用，先准备可登录的账号和工作空间；已有项目时，可以按左侧模块直接查找操作。工具与 AI 应用拥有各自独立的文档目录。

## 选择文档

<CardGroup>
<Card title="使用平台" href="/docs.html?page=quickstart" icon="knowledge">
从第一个模型开始，管理素材、组织项目，完成你的创作。
</Card>
<Card title="编写自动化" href="/docs.html?page=sdk-quickstart" icon="tools">
用 Python 调用模型，精确编辑工坊内容，把操作组合成可重复的流程。
</Card>
<Card title="查询 API" href="/docs.html?page=api-reference" icon="key">
按业务模块查询接口、参数、权限和错误，找到与你的操作对应的调用方法。
</Card>
<Card title="开发与运维" href="/docs.html?page=dev-production-deployment" icon="deploy">
了解部署方式、项目架构和维护流程。内部开发资料按账号权限开放。
</Card>
</CardGroup>

## 常用模块

- [工作空间与账号](/docs.html?page=workspaces)：切换空间、邀请成员、管理个人资料和会话。
- [文件管理](/docs.html?page=files-overview)：上传、预览和整理共享文件。
- [集成中心](/docs.html?page=integrations-overview)：管理工具 API、MCP 与 Skill。
- [录音分段标注](/docs.html?page=annotation-overview)：切分音频、校对文本和导出字幕。
- [视频帧导出](/docs.html?page=frames-overview)：在浏览器中定位画面并保存图片。

## 本地优先与自动保存 {#local-first}

- 平台采用单机部署，同一实例内通过账号和逻辑工作空间隔离。项目保存在部署机器，不等于保存在当前浏览器。
- 项目不会自动成为云端多人协作空间。实时语音的转写与音频只保留在当前页面内存中。
- 画布和故事采用 revision 检测并发冲突；发生冲突时先检查服务器快照，不会静默覆盖。
- 图片和视频生成是异步任务；完成结果会进入对应项目素材库。
- 删除仍被项目引用的素材前，需要先解除引用。

> 文档以当前可见功能和实际界面为准；模型能力、时长和分辨率选项取决于已配置的生成模型。

## 推荐阅读顺序 {#reading-path}

1. **认识平台**：[能力边界](/docs.html?page=platform) → [空间、项目与素材](/docs.html?page=concepts)。
2. **准备环境**：[首次登录](/docs.html?page=quickstart) → [协议类型与认证配置](/docs.html?page=providers) → [连接测试](/docs.html?page=models-diagnostics)。
3. **验证模型**：[模式选择](/docs.html?page=test-overview) → [文本对话](/docs.html?page=test-chat) → [调用日志](/docs.html?page=logs-overview)。
4. **完成创作**：[选择应用](/docs.html?page=apps-overview)，进入对应工坊的快速开始。
5. **整理交付**：[素材复用](/docs.html?page=files-references) → [项目快照](/docs.html?page=project-snapshots)。
