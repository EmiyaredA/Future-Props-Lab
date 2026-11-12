# README 平台与工坊截图

拍摄日期：2026-11-12。来源为本机 Chrome 中现有账号的真实界面与项目页面。
工坊截图仅浏览、播放预览和调整取景。本轮按用户授权新增并发布三项原创 Skill，并通过 Amadeus 运行一次真实的只读项目分析任务；未修改项目节点、生成图片或视频、安装创作、验证集成或连接远程应用。图片由浏览器直接截取为 JPEG，不含浏览器标签栏。

根 README 的九类平台能力按三行三列排列，八个工坊保留每行两列。缩略图保持原始宽高比，HTML 只设宽度、不指定高度；点击缩略图打开完整工作区截图，创意工坊另有作品详情截图链接。

## 场景与取景

- 视觉创作使用用户指定的《石头门》新宿决战项目，仅缩放和平移取景，没有移动节点。
- 演示使用用户指定的《PPT Agent｜三次技术选择与核心流程》第 7 页「大纲与模板选择」。
- 视频剪辑使用用户指定的「石头门-新宿决战」工程，停帧位置为 00:36.049。截图时关闭精确停帧，以同一时间点的普通视频预览避开精确帧错误提示；完成后恢复原预览开关。
- 思绪工坊展示已导入的官方使用指南首页。特效制作展示现有片头草稿，画面中仍有默认标题，不代表最终成片。

以下局部预览由浏览器截图区域直接截取，不重采样、不拉伸。坐标顺序为 `(x, y, width, height)`；各缩略图点击后均打开对应完整截图。

| 局部预览 | 来源完整截图 | 截取区域 |
| --- | --- | --- |
| visual-workshop-preview.jpg | visual-workshop.jpg | `(100, 75, 1280, 800)` |
| video-editor-preview.jpg | video-editor.jpg | `(0, 0, 1280, 800)` |
| presentation-workshop-preview.jpg | presentation-workshop.jpg | `(185, 120, 1120, 700)` |
| amadeus-assistant-preview.jpg | amadeus-assistant.jpg | `(600, 0, 1000, 800)` |
| creative-workshop-preview.jpg | creative-workshop.jpg | `(80, 55, 960, 600)` |

截图只用于项目介绍；其中角色、场景与作品素材沿用原有使用限制，未新增再分发许可。详见[仓库素材清单](../MANIFEST.md)。

## 平台界面取景

- 九类平台界面均拍摄于 2026-11-12。模型测试使用已有「你好」对话，没有发送新消息。
- Amadeus 使用已启用的 Codex 连接与 CLI 默认模型，实际读取用户指定的新宿决战画布，返回素材组织概述与三条分镜建议。任务已完成，没有改写节点或触发媒体生成；回复明确依据为画布数据而非完整视频观看。
- 本轮工具调用共 5 步，画布读取中有两次失败后恢复，最终读取成功并生成回复。完整截图保留工具组的「部分步骤失败」标记及底部「模型目录暂不可用」状态；目录发现失败没有阻止本次 CLI 默认模型运行，不据此宣称所有步骤无误。
- 按用户授权在创意工坊新增并发布「分镜创作简报」「演示大纲助手」「创作交付检查」三项原创 Skill，均为 v1，分别采用 ocean、violet、mint 内置封面。ZIP 仅含原创 SKILL.md，通过本地格式检查与应用上传校验；未带入集成、私有文件或凭据，未执行安装。
- 创意广场截图展示三项实际发布的作品；详情截图为「分镜创作简报」页面，滚动至名称、用途和建议步骤，不触发安装依赖检查。
- 调用日志筛选为「网页会话」，避开凭据前缀；仅展示列表，没有打开请求正文或详情。
- 文件管理只展示用户已指定的新宿决战项目素材，临时切换卡片视图后恢复列表视图。
- 集成中心使用有内容的 Skill 列表，没有打开凭据编辑页或触发验证。云控只展示已配置应用和未连接入口。
- 本轮 Amadeus 与创意工坊完整截图、作品详情均为 1600 × 1000；两张局部预览的取景见上表。所有图片无浏览器标签栏、无重采样和拉伸。

## 文件校验

| 文件 | 应用 | 展示场景 | 尺寸 | SHA-256 |
| --- | --- | --- | --- | --- |
| [audio-annotation.jpg](audio-annotation.jpg) | 录音标注工坊 | 广播剧项目的波形、说话人与多语言分段 | 1600 × 1000 | `72b719e062b33e23d40eec9b11c2702a21f810f4f0f701466a40559e3b265d74` |
| [director-desk.jpg](director-desk.jpg) | 3D 导演台 | 实验室预演项目的三维布景、机位监看与时间线 | 1600 × 1000 | `27ba608aee3dfbe1127a0e63c0f91c1a00761c2f72ef5db525eebba01d9138f8` |
| [galgame-workshop.jpg](galgame-workshop.jpg) | Galgame 工坊 | 广播剧项目的剧本卡片与实时场景预览 | 1600 × 1000 | `7c3174766d9cab0bfc69445d8e0ee982c704c1f099277937f8866005e2bfd511` |
| [motion-compositor.jpg](motion-compositor.jpg) | 特效制作工坊 | 怪盗风格片头草稿的图层时间线与二维动画预览 | 1600 × 1000 | `efd06db475b4bfe1f5e8ddb80676ca1a8e135414553522ce7dfeffa98cb03fdd` |
| [presentation-workshop-preview.jpg](presentation-workshop-preview.jpg) | 演示工坊 | PPT Agent 文稿第 7 页「大纲与模板选择」及编辑工作区（局部预览） | 1120 × 700 | `6b5614a1687569b109cf0a5d0a2e92e94ae4769aaffba60c6de3c585d530f34c` |
| [presentation-workshop.jpg](presentation-workshop.jpg) | 演示工坊 | PPT Agent 文稿第 7 页「大纲与模板选择」及编辑工作区 | 1600 × 1000 | `7174c588cf3ce9f75eed88e69302ed4798879d4de56f11eff82a5c882b705aa1` |
| [thought-workshop.jpg](thought-workshop.jpg) | 思绪工坊 | 已导入官方指南的知识库首页编辑与文档目录 | 1600 × 1000 | `c0620e75bca13f5fe801c5f66a07bab551b9955997d5688c554980aaf3f38097` |
| [video-editor-preview.jpg](video-editor-preview.jpg) | 视频剪辑工坊 | 石头门-新宿决战工程 00:36.049 的节目预览与多轨时间线（局部预览） | 1280 × 800 | `ee2ef3400e2079b40f777aba612d09f27ffd39194e78d2a6fc29b256d24ba966` |
| [video-editor.jpg](video-editor.jpg) | 视频剪辑工坊 | 石头门-新宿决战工程 00:36.049 的节目预览与多轨时间线 | 1470 × 867 | `84f4606466295e5cf89ef1c06c88b8b969c6f66efd07d66c388d9ea15165b23f` |
| [visual-workshop-preview.jpg](visual-workshop-preview.jpg) | 视觉创作工坊 | 《石头门》新宿决战项目的分镜素材与节点连线（局部预览） | 1280 × 800 | `085f291b12e384d50b67c5bac76484ed136474df6b0caa5b75365f652cb68e09` |
| [visual-workshop.jpg](visual-workshop.jpg) | 视觉创作工坊 | 《石头门》新宿决战项目的分镜素材与节点连线 | 1600 × 1000 | `89cc90ffafb252208f87e01ef10b7e11d5f50d321fbddf142b8a24048767e84b` |
| [amadeus-assistant.jpg](amadeus-assistant.jpg) | Amadeus | 实际读取新宿决战画布的工具调用、三条分镜建议及本轮完成状态 | 1600 × 1000 | `8c7dac9e0c1136e8a87cf30ccaee411e3a59338dcee16ab1dcc92392bc74cf01` |
| [model-services.jpg](model-services.jpg) | 模型服务 | 接入连接概览、模型目录与能力分类 | 1600 × 1000 | `370fe5f70e675b090c44926e4fbd0e57ba21f7b85fee293998950ea478b6ac1a` |
| [model-playground.jpg](model-playground.jpg) | 模型测试 | 已有的「你好」问候对话、测试类型和生成参数 | 1600 × 1000 | `6003b38872660fa21b76f76bab3e6a714940678d161df14f92b33a46b52c106d` |
| [model-call-logs.jpg](model-call-logs.jpg) | 调用日志 | 筛选为网页会话的调用记录、Token、耗时与成功失败状态；未打开正文 | 1600 × 1000 | `7c68960ea51dad674369d28d478fbd578d937f2362ab2c7abb0e0fcbbb26dd23` |
| [creative-workshop.jpg](creative-workshop.jpg) | 创意工坊 | 已发布的分镜创作简报、演示大纲助手与创作交付检查三项原创 Skill | 1600 × 1000 | `2ed8cbe82e7a0a89c0f3a97994044d1c2092cb269c6f1768946a4f3ccbe46f63` |
| [file-manager.jpg](file-manager.jpg) | 文件管理 | 新宿决战项目文件夹内实际视频素材的卡片预览 | 1600 × 1000 | `c7261e2aac54eb17e4b7610b99be0a8b9a052e28e94e2b80f0258a13f864aa09` |
| [tools-directory.jpg](tools-directory.jpg) | 工具导航 | 工具分类、站内工具与带外链标记的外部工具 | 1600 × 1000 | `ab6a20505ebbc95c256b4c423276d00b6e9406df44e8c65cfcff5afc2021c77d` |
| [integration-center.jpg](integration-center.jpg) | 集成中心 | 已有 Skill 的状态、标签、不可变版本与能力分类 | 1600 × 1000 | `f54ede91ceada7a65596553ce6f41c76e7ffff0db7324bfbfcb455563756c8c3` |
| [cloud-control.jpg](cloud-control.jpg) | 云控 | Mac 应用标签、连接入口与真实未连接状态 | 1600 × 1000 | `ab5c1b9036d16a02d189f60152b128ff0d1a60f65175d59eb2f58a96db76813f` |
| [amadeus-assistant-preview.jpg](amadeus-assistant-preview.jpg) | Amadeus | 画布局部与实际执行回复（局部预览） | 1000 × 800 | `beb3daea899cfd2d87f6b5ffb3222e75874f3a11a955017b158c26270dbddd40` |
| [creative-workshop-preview.jpg](creative-workshop-preview.jpg) | 创意工坊 | 三项已发布原创 Skill 的卡片、标题与简介（局部预览） | 960 × 600 | `7eb7e65db76bc161405c3ea92fac89139f348afe59f79250155372de4761e52d` |
| [creative-workshop-detail.jpg](creative-workshop-detail.jpg) | 创意工坊 | 分镜创作简报 v1 的实际用途、使用步骤与标签 | 1600 × 1000 | `f139b19ce448e3d131aefd4a79837d9aa57e7d031af27eb98d3e93d2043ae11b` |
