<!-- docs: {"group":"creative","order":0,"title":"发现与安装公开能力","lead":"把同一部署内公开的工具 API、MCP、Skill 或方案复制到当前空间。","evidence":["web/src/features/creative-workshop/CreativeWorkshopPage.tsx","web/src/features/creative-workshop/CreativeDetail.tsx","backend/app/console/creative_workshop","web/e2e/creative-workshop.spec.ts"]} -->

# 发现与安装公开能力

从 Studio 的「创意工坊」进入「创意广场」。这里展示同一部署内面向登录用户发布的能力；浏览公开条目不会暴露作者 Workspace 的私有配置。

## 找到适合的创作

按工具 API、MCP、Skill 或方案筛选，用名称、用途和关键词搜索。打开详情，核对作者、版本、用途与说明；方案详情还显示所含能力及其固定版本。

「我的创作」用于管理自己在当前空间的草稿和发布版本。发布内容的方法见[草稿与版本发布](/docs.html?page=creative-publishing)。

## 检查并确认安装

1. 先确认当前 Workspace，安装需要集成管理权限。
2. 在详情点击「检查安装依赖」，查看目标名称、已安装版本、依赖和待配置项。
3. 名称冲突时修改目标名称，再点击「重新检查名称」。不要把名称调整当成覆盖已有集成。
4. 检查通过后点击「确认安装」，等待「安装完成」。

安装的是固定版本的独立副本；发布者以后的更新不会自动改动现有配置。已经安装过的相同版本会在预检中标识，不需要重复复制。

## 安装后配置和启用

工具 API、HTTP MCP 与 Skill 默认禁用。API 和 HTTP MCP 的凭据不会从作者空间复制；到[集成中心](/docs.html?page=integrations-overview)补充当前环境配置，验证后再启用。

stdio MCP 安装后处于待配置状态，需要目标空间管理员填写本机命令和参数，再到集成中心校验、启用。保存命令不等于已经成功启动服务。

方案不会自动运行。依赖版本撤回后仍可能看到方案详情，但不能新安装；已经安装的副本不会随撤回被删除。

![确认安装前检查固定版本、目标名称与禁用状态](/docs/creative-install.jpg "真实界面 · 隔离数据与合成示例；不代表外部模型效果。")
