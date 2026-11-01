# 应用总览与选用

先说清最终要交付什么，再选择应用：可编辑文稿、可玩的故事、带字幕的视频，还是一篇有图的说明。完成本篇后，你应能选出主应用，并知道什么时候需要导入素材或显式交接。

## 按结果选择应用

| 你要得到的结果                    | 应用                                                                                                 | 建议先完成的小任务       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| 本机 APP / CLI 编程会话记录与同步 | Agent 工作台 | 绑定一个来源并查看已有会话 |
| 幻灯片、放映、可编辑 PPTX         | [演示工坊](/apps/thought-workshop/official-knowledge-bases/presentation-workshop/documents/overview) | 三页产品介绍             |
| 文档、附件、历史、UML 与信息图    | [思绪工坊](/apps/thought-workshop/official-knowledge-bases/thought-workshop/documents/overview)      | 一篇带标题和画板的说明   |
| 图片或视频生成、素材节点关系      | [视觉创作工坊](/apps/thought-workshop/official-knowledge-bases/visual-workshop/documents/overview)   | 一张参考图的一次生成     |
| 角色演出、分支剧情、路线视频      | [Galgame 工坊](/apps/thought-workshop/official-knowledge-bases/galgame-workshop/documents/overview)  | 能从头试玩到结束的短片段 |
| 多轨画面、字幕、声音与成片        | [视频剪辑工坊](/apps/thought-workshop/official-knowledge-bases/video-editor/documents/overview)      | 带声音的短视频           |
| 二维动画、路径遮罩、透明镜头      | [特效制作工坊](/apps/thought-workshop/official-knowledge-bases/motion-compositor/documents/overview) | 一段短动画               |
| 分层角色、绑定、动作、Cubism 对照 | [Live2D 工坊](/apps/thought-workshop/official-knowledge-bases/live2d-workshop/documents/overview)    | 一个可预览的参数动作     |
| 桌宠皮肤、事件台词、桌面运行      | [桌宠工坊](/apps/thought-workshop/official-knowledge-bases/desktop-pet/documents/overview)           | 一组可模拟的事件反应     |
| 录音分段、说话人、情绪与字幕      | [录音标注工坊](/apps/thought-workshop/official-knowledge-bases/audio-annotation/documents/overview)  | 一段已校对的短录音       |
| 三维布景、走位、摄影机预演        | [导演台](/apps/thought-workshop/official-knowledge-bases/director-desk/documents/overview)           | 一个镜头的可复核预演     |

## 查看已有编程会话

1. 在 FPL 桌面窗口打开「应用 → 开发辅助 → Agent 工作台 → 来源」。
2. 选择 Codex、Claude Code、OpenCode、DeepSeek Harness 或 Pi，选择实际会话目录，确认允许当前账号保存阅读副本，再绑定来源。
3. 返回「会话」，选择已有 APP 或 CLI 记录，核对项目路径、来源依据和最后同步时间。没有可靠标记时显示「来源待确认」。
4. 在原 APP 或 CLI 中产生新记录，观察工作台更新。上翻后使用「有新内容」回到底部；「暂停跟随」只影响当前视图，原 Agent 继续运行。

**完成标志：** 已有消息可阅读，原端新增的完整记录能自动出现。日志跟随不保证逐 token 更新；Pi 无默认目录时需选择实际宿主目录。只读历史不要求 CLI 已登录。本批输入区禁用，继续对话尚未接入；普通云端聊天不属于来源。

来源和阅读副本归当前账号，管理员不能读取他人的会话。停用或解绑只停止采集，保留原生日志；清除 FPL 阅读副本需先停用相关来源。附件只可下载已引用且位于绑定来源根内的文件。

## 一条可以逐步验收的创作链

例如制作一条产品短片：

1. 在视觉创作工坊准备图片或生成视频，确认结果已完成并能读取。
2. 若需要二维动画或透明效果，在特效制作工坊制作镜头，并检查它自己的导出结果。
3. 通过目标应用支持的素材导入或明确交接，把已完成媒体放进视频剪辑工程。
4. 在剪辑工坊安排镜头、声音与字幕，运行导出预检，下载并检查 MP4。
5. 同时保存可编辑工程；要交给别人继续修改时，提供应用支持的工程包，而不只发 MP4。

**完成标志：** 每一环都有已保存的输入与输出，最终文件在接收设备可正常播放或打开。

## 交接前确认三件事

- **格式是否匹配：** 各应用工程结构不同，不能把一种工程 JSON 当作另一种工程导入。
- **媒体是否完整：** 只有项目引用或截图，通常不足以在别处继续编辑。
- **副本是否独立：** 交接后的内容不会跟随来源自动更新。修改来源后需要重新导出或导入，并检查目标版本。

> [!TIP]
> 先完成最小作品再扩大规模。生成、排版、叙事和剪辑各自验收，更容易发现问题来自哪个阶段。

## 不确定选哪一个时

整理素材关系或提交生成选视觉创作；安排镜头时间、字幕和声音选视频剪辑；表达技术结构与流程选思绪工坊的信息图；需要分支和角色叙事选 Galgame。进入对应库的“功能概览与快速开始”，先走一遍示例，再查看详细操作。

## 相关阅读

- [入门与基本概念](/apps/thought-workshop/official-knowledge-bases/general/documents/start)
- [视觉创作工坊：功能概览与快速开始](/apps/thought-workshop/official-knowledge-bases/visual-workshop/documents/overview)
- [视频剪辑工坊：导入导出与交付](/apps/thought-workshop/official-knowledge-bases/video-editor/documents/delivery)
