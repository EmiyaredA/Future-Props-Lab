export const PLATFORM_READING: Record<
  string,
  {
    summary: string;
    related: readonly { libraryId: string; documentId: string }[];
  }
> = {
  "general/start": {
    summary:
      "从确认工作空间到保存第一件作品，建立模型、项目与文件的基本使用顺序。",
    related: [
      {
        libraryId: "general",
        documentId: "applications",
      },
      {
        libraryId: "general",
        documentId: "accounts",
      },
      {
        libraryId: "general",
        documentId: "models",
      },
    ],
  },
  "general/accounts": {
    summary:
      "确认当前空间、区分阅读和管理权限，并安全处理成员变更与自动化凭证。",
    related: [
      {
        libraryId: "general",
        documentId: "start",
      },
      {
        libraryId: "general",
        documentId: "automation",
      },
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
    ],
  },
  "general/models": {
    summary:
      "配置供应商地址、凭证与模型能力，接入 Seedance 官方视频并用最小请求验证。",
    related: [
      {
        libraryId: "general",
        documentId: "testing",
      },
      {
        libraryId: "general",
        documentId: "logs",
      },
      {
        libraryId: "visual-workshop",
        documentId: "overview",
      },
    ],
  },
  "general/testing": {
    summary:
      "用小请求验证文字、媒体和实时语音，并在中断后正确查询与恢复原任务。",
    related: [
      {
        libraryId: "general",
        documentId: "models",
      },
      {
        libraryId: "general",
        documentId: "logs",
      },
      {
        libraryId: "visual-workshop",
        documentId: "storage",
      },
    ],
  },
  "general/logs": {
    summary:
      "按时间、来源与任务定位一次调用，分辨服务错误和结果保存错误并准备有效诊断。",
    related: [
      {
        libraryId: "general",
        documentId: "testing",
      },
      {
        libraryId: "general",
        documentId: "models",
      },
      {
        libraryId: "general",
        documentId: "accounts",
      },
    ],
  },
  "general/files": {
    summary: "上传并复用工作空间文件，理解项目副本、素材引用和删除保护的区别。",
    related: [
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "storage",
      },
      {
        libraryId: "general",
        documentId: "accounts",
      },
    ],
  },
  "general/integrations": {
    summary:
      "配置工具 API、MCP、Skill 和飞书外部连接，分别验证对话能力与文章同步授权。",
    related: [
      {
        libraryId: "general",
        documentId: "creative",
      },
      {
        libraryId: "general",
        documentId: "desktop",
      },
      {
        libraryId: "general",
        documentId: "logs",
      },
    ],
  },
  "general/creative": {
    summary: "检查固定依赖版本并安装独立副本，补齐环境配置后再验证和使用。",
    related: [
      {
        libraryId: "general",
        documentId: "integrations",
      },
      {
        libraryId: "general",
        documentId: "accounts",
      },
      {
        libraryId: "general",
        documentId: "desktop",
      },
    ],
  },
  "general/desktop": {
    summary:
      "核对 Amadeus 上下文和能力范围，完成桌面配对并区分会话文件与项目素材。",
    related: [
      {
        libraryId: "general",
        documentId: "integrations",
      },
      {
        libraryId: "general",
        documentId: "automation",
      },
      {
        libraryId: "general",
        documentId: "testing",
      },
    ],
  },
  "general/tools": {
    summary: "区分内置与外部工具，并从视频定位、下载一帧到重新用于作品。",
    related: [
      {
        libraryId: "visual-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
      {
        libraryId: "audio-annotation",
        documentId: "overview",
      },
    ],
  },
  "general/automation": {
    summary:
      "通过独立 Python SDK 创建可见作品，掌握版本冲突、素材归属和下载的正确顺序。",
    related: [
      {
        libraryId: "general",
        documentId: "accounts",
      },
      {
        libraryId: "general",
        documentId: "desktop",
      },
      {
        libraryId: "thought-workshop",
        documentId: "delivery",
      },
    ],
  },
  "general/applications": {
    summary: "从最终交付物选择十个应用，并规划素材生成、编辑和交接的顺序。",
    related: [
      {
        libraryId: "general",
        documentId: "start",
      },
      {
        libraryId: "visual-workshop",
        documentId: "overview",
      },
      {
        libraryId: "video-editor",
        documentId: "delivery",
      },
    ],
  },
  "presentation-workshop/overview": {
    summary:
      "直接打开文稿或按需预览，从封面到放映完成三页介绍，认识页面、元素与备注的编辑位置。",
    related: [
      {
        libraryId: "presentation-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "storage",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "delivery",
      },
    ],
  },
  "presentation-workshop/workflow": {
    summary:
      "设置正文圆点与编号列表，缩放查看细节，对照视觉稿重建信息图，逐层编辑组内元素并调节连接样式与前后层级。",
    related: [
      {
        libraryId: "presentation-workshop",
        documentId: "overview",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "storage",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "help",
      },
    ],
  },
  "presentation-workshop/storage": {
    summary:
      "使用统一快捷键撤销文字、页面与素材引用，核对会话历史和保存结果，处理冲突并归档原始生成图。",
    related: [
      {
        libraryId: "presentation-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "help",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
    ],
  },
  "presentation-workshop/delivery": {
    summary:
      "从放映验收到可编辑 PPTX 交付，核对字体、素材，以及普通连接和自由曲线的编辑边界。",
    related: [
      {
        libraryId: "presentation-workshop",
        documentId: "storage",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "help",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
    ],
  },
  "presentation-workshop/help": {
    summary:
      "按整组选择、图片裁剪、文字选区、字体替换与保存冲突等现象找到处理步骤。",
    related: [
      {
        libraryId: "presentation-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "storage",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "delivery",
      },
    ],
  },
  "thought-workshop/overview": {
    summary:
      "创建个人知识库、写下第一篇文档，并选择源码图表或可视化画板表达思路。",
    related: [
      {
        libraryId: "thought-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
      {
        libraryId: "thought-workshop",
        documentId: "delivery",
      },
    ],
  },
  "thought-workshop/workflow": {
    summary:
      "完成图文笔记和多维表格，配置字段、三种视图，并在正文嵌入可编辑数据。",
    related: [
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
      {
        libraryId: "thought-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "thought-workshop",
        documentId: "help",
      },
    ],
  },
  "thought-workshop/storage": {
    summary:
      "确认笔记与画板保存、使用历史还原，并理解文件为何仍被历史或回收站引用。",
    related: [
      {
        libraryId: "thought-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "thought-workshop",
        documentId: "help",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
    ],
  },
  "thought-workshop/delivery": {
    summary:
      "绑定飞书文档并手动同步文章，或选择 CSV、阅读导出和完整备份交付资料。",
    related: [
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
      {
        libraryId: "thought-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "general",
        documentId: "automation",
      },
    ],
  },
  "thought-workshop/help": {
    summary:
      "从找不到文档、图表报错到画板保存和文件删除，按现象定位原因与修复办法。",
    related: [
      {
        libraryId: "thought-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
      {
        libraryId: "thought-workshop",
        documentId: "delivery",
      },
    ],
  },
  "visual-workshop/overview": {
    summary:
      "先整理提示与参考素材，再完成一次媒体生成并核对任务、结果和画布保存。",
    related: [
      {
        libraryId: "visual-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "visual-workshop",
        documentId: "storage",
      },
      {
        libraryId: "general",
        documentId: "models",
      },
    ],
  },
  "visual-workshop/workflow": {
    summary:
      "组织输入连线与参考素材，使用 Seedance 视频模型、查看生成状态，并完成裁剪与取帧。",
    related: [
      {
        libraryId: "visual-workshop",
        documentId: "storage",
      },
      {
        libraryId: "visual-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "visual-workshop",
        documentId: "help",
      },
    ],
  },
  "visual-workshop/storage": {
    summary:
      "上传素材时选择分类与分组，将 GIF 保存为视频版本，删除人工上传的输出版本并核对最终输出，分别验收结果落盘与画布保存。",
    related: [
      {
        libraryId: "visual-workshop",
        documentId: "help",
      },
      {
        libraryId: "visual-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "general",
        documentId: "logs",
      },
    ],
  },
  "visual-workshop/delivery": {
    summary:
      "选择媒体下载或项目快照交付，保留节点关系并正确处理取帧、裁剪和跨应用素材。",
    related: [
      {
        libraryId: "visual-workshop",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "overview",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
    ],
  },
  "visual-workshop/help": {
    summary:
      "按模型不可选、复制任务缺失、结果保存失败等现象区分配置与画布问题。",
    related: [
      {
        libraryId: "visual-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "visual-workshop",
        documentId: "storage",
      },
      {
        libraryId: "general",
        documentId: "models",
      },
    ],
  },
  "galgame-workshop/overview": {
    summary:
      "建立能从入口试玩到结束的短故事，分清章节、Fragment、Block 与角色身份。",
    related: [
      {
        libraryId: "galgame-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "storage",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "delivery",
      },
    ],
  },
  "galgame-workshop/workflow": {
    summary: "先连通剧情分支，再安排角色、舞台、配音与时间轴，并逐条线路试玩。",
    related: [
      {
        libraryId: "galgame-workshop",
        documentId: "overview",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "help",
      },
    ],
  },
  "galgame-workshop/storage": {
    summary:
      "保存整体 Story，维护稳定资源引用，并在修改后重新验收冻结的导出快照。",
    related: [
      {
        libraryId: "galgame-workshop",
        documentId: "delivery",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "help",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
    ],
  },
  "galgame-workshop/delivery": {
    summary: "选择可编辑工程或确定路线视频，完成分支选择、快速试片与剪辑交接。",
    related: [
      {
        libraryId: "galgame-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "overview",
      },
    ],
  },
  "galgame-workshop/help": {
    summary:
      "从走不到的分支、重复配音到旧视频未更新，定位剧情、素材与快照问题。",
    related: [
      {
        libraryId: "galgame-workshop",
        documentId: "workflow",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "storage",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "delivery",
      },
    ],
  },
  "video-editor/overview": {
    summary: "用一段短素材完成入轨、剪切、试听和导出，认识源素材与时间线片段。",
    related: [
      {
        libraryId: "video-editor",
        documentId: "workflow",
      },
      {
        libraryId: "video-editor",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "delivery",
      },
    ],
  },
  "video-editor/workflow": {
    summary:
      "安排多轨片段和字幕，检查锁定删除、素材就绪与转场相邻切镜预览，处理精确空隙。",
    related: [
      {
        libraryId: "video-editor",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "delivery",
      },
      {
        libraryId: "video-editor",
        documentId: "help",
      },
    ],
  },
  "video-editor/storage": {
    summary:
      "确认顺序保存并处理未保存操作，整理、重命名和下载原素材，区分代理缓存与渲染快照。",
    related: [
      {
        libraryId: "video-editor",
        documentId: "help",
      },
      {
        libraryId: "video-editor",
        documentId: "delivery",
      },
      {
        libraryId: "general",
        documentId: "files",
      },
    ],
  },
  "video-editor/delivery": {
    summary: "先预检再导出MP4，区分含效果的完整渲染、原始片段导出与工程包。",
    related: [
      {
        libraryId: "video-editor",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "help",
      },
      {
        libraryId: "visual-workshop",
        documentId: "delivery",
      },
    ],
  },
  "video-editor/help": {
    summary:
      "按代理、字幕、同步、预检和保存错误找到处理顺序，不用重复渲染掩盖原因。",
    related: [
      {
        libraryId: "video-editor",
        documentId: "workflow",
      },
      {
        libraryId: "video-editor",
        documentId: "storage",
      },
      {
        libraryId: "video-editor",
        documentId: "delivery",
      },
    ],
  },
};
