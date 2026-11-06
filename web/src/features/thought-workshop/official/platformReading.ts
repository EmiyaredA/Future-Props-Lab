export const PLATFORM_READING: Record<
  string,
  {
    summary: string;
    related: readonly { libraryId: string; documentId: string }[];
  }
> = {
  "general/start": {
    summary:
      "从确认当前账号到保存第一件作品，建立模型、项目与文件的基本使用顺序。",
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
      "配置供应商地址、凭证与能力，接入 DeepSeek 官方对话和 Seedance 视频并验证。",
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
    summary: "上传并复用账号文件，理解项目副本、素材引用和删除保护的区别。",
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
      "核对 Amadeus 上下文、桌面配对与项目素材，并从头像菜单启停本地及公网访问。",
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
    summary:
      "使用 GrandPerspective 定位占空间的目录，区分工具运行位置，并从视频导出一帧用于作品。",
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
      "使用紧凑编辑器、公式模板、表格图表与媒体，调节页面、样式、动画和双窗口放映，保留统一历史。",
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
      "预检导入 PPTX 与文稿包，交付原生对象、图片和打印 PDF，核对转换报告与跨空间素材。",
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
      "组织输入连线与参考素材，使用视频模型、管理图片／视频等待队列，并完成裁剪与取帧。",
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
      "通过缩略图、媒体格式和放大预览绑定验收参考，发布标准并复验输出，选择媒体下载或项目快照交付。",
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
  "agent-workbench/overview": {
    summary:
      "日常网站的云控通过 Happier 管理编程会话。指定管理员需要 FPL 密码解锁和 Happier 设备密钥。",
    related: [
      { libraryId: "agent-workbench", documentId: "workflow" },
      { libraryId: "agent-workbench", documentId: "storage" },
    ],
  },
  "agent-workbench/workflow": {
    summary: "使用经过管理员批准配对的 Runner，选择授权项目和已经配置的 CLI。",
    related: [
      { libraryId: "agent-workbench", documentId: "storage" },
      { libraryId: "agent-workbench", documentId: "delivery" },
    ],
  },
  "agent-workbench/storage": {
    summary:
      "Happier 的设备密钥保护新会话。旧 FPL 会话随停机快照归档，可用对应部署版本恢复。",
    related: [
      { libraryId: "agent-workbench", documentId: "delivery" },
      { libraryId: "agent-workbench", documentId: "help" },
    ],
  },
  "agent-workbench/delivery": {
    summary: "Happier 原生会话管理回复、审批和项目文件浏览。",
    related: [
      { libraryId: "agent-workbench", documentId: "help" },
      { libraryId: "agent-workbench", documentId: "overview" },
    ],
  },
  "agent-workbench/help": {
    summary: "先区分 Studio 入口、FPL 解锁、Relay 和 Runner 状态，再恢复连接。",
    related: [
      { libraryId: "agent-workbench", documentId: "overview" },
      { libraryId: "agent-workbench", documentId: "workflow" },
    ],
  },
  "interview-assistant/overview": {
    summary:
      "在应用中心打开面试助手，填写岗位名称与 JD，粘贴简历或上传原件。确认页面的本机 Codex 连接已安装、登录且被管理员授权用于面试资料准备，再开始准备。",
    related: [
      { libraryId: "interview-assistant", documentId: "workflow" },
      { libraryId: "interview-assistant", documentId: "storage" },
    ],
  },
  "interview-assistant/workflow": {
    summary:
      "提交材料后查看实际任务状态。Codex 读取本场 JD 与简历，检索来源并交付需求、经历、主题、题目与评分要点。离开页面不会取消后台准备；回来后重新读取任务状态，确认成功",
    related: [
      { libraryId: "interview-assistant", documentId: "storage" },
      { libraryId: "interview-assistant", documentId: "delivery" },
    ],
  },
  "interview-assistant/storage": {
    summary:
      "房间、只读上传材料、准备任务及结构化资料由后端按当前账号持久化；内容更新使用版本校验，不覆盖其他窗口保存的新版本。查看历史时先确认当前房间和任务标识。",
    related: [
      { libraryId: "interview-assistant", documentId: "delivery" },
      { libraryId: "interview-assistant", documentId: "help" },
    ],
  },
  "interview-assistant/delivery": {
    summary:
      "准备完成后可下载 Markdown 或 JSON 资料，核对岗位、来源与题目内容。Markdown 便于阅读，JSON 保留结构化字段；下载文件不改变本场准备任务，也不代",
    related: [
      { libraryId: "interview-assistant", documentId: "help" },
      { libraryId: "interview-assistant", documentId: "overview" },
    ],
  },
  "interview-assistant/help": {
    summary:
      "连接不可用时在「模型与智能体 → 编程智能体」核对本机 Codex 路径、登录和面试用途授权，再点击重新检查。来源检索失败或材料不完整时应查看任务说明，补全材料后手动重新",
    related: [
      { libraryId: "interview-assistant", documentId: "overview" },
      { libraryId: "interview-assistant", documentId: "workflow" },
    ],
  },
};
