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
    summary: "把供应商地址、凭证与模型能力逐项配置，再用最小请求确认连接可用。",
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
      "分别配置工具 API、MCP 与 Skill，验证后在当前对话中选择需要的能力。",
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
      "不用模型，从封面到放映完成三页介绍，认识页面、元素与备注的编辑位置。",
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
    summary: "按选区调整文字、图片与矢量元素，完成对齐、裁剪和页面排序。",
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
    summary: "区分自动保存、撤销和图片引用，处理冲突后再离开或导出。",
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
    summary: "从放映验收到可编辑 PPTX 交付，核对字体、素材与当前导入容量限制。",
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
    summary: "按图片裁剪、文字选区、字体替换与保存冲突等现象找到处理步骤。",
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
      "从块编辑和目录整理到 UML、画板与官方图复用，逐步完成可编辑图文笔记。",
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
      "按继续编辑、文本交换或离线阅读选择格式，完成带图片与画板的导入导出。",
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
    summary: "组织输入连线、复制节点组，并完成不改写原文件的裁剪和视频取帧。",
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
      "把生成、结果落盘和画布保存分别验收，中断后优先恢复原任务与已上传结果。",
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
    summary: "安排多轨片段、批量属性和字幕，结合代理预览与精确帧检查切点。",
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
      "了解顺序保存与未保存操作处理，区分原素材、代理缓存和固定渲染快照。",
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
