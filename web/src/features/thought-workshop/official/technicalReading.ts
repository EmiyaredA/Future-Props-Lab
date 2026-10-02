/** Concise reading context for the bundled technical principles chapters. */
export const TECHNICAL_READING: Record<
  string,
  {
    summary: string;
    related: readonly { libraryId: string; documentId: string }[];
  }
> = {
  system: {
    summary: "沿着一次画板保存，分清界面状态、业务校验、数据库记录和素材文件。",
    related: [
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "technical",
        documentId: "assets",
      },
      {
        libraryId: "technical",
        documentId: "modules",
      },
    ],
  },
  modules: {
    summary: "用官方阅读和画板保存两种改动，判断代码应该落在哪个功能边界。",
    related: [
      {
        libraryId: "technical",
        documentId: "system",
      },
      {
        libraryId: "technical",
        documentId: "engineering",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
    ],
  },
  identity: {
    summary:
      "把身份、权限和资源归属拆开，解释同名知识库与跨空间 ID 的不同结果。",
    related: [
      {
        libraryId: "technical",
        documentId: "automation",
      },
      {
        libraryId: "technical",
        documentId: "assets",
      },
      {
        libraryId: "general",
        documentId: "accounts",
      },
    ],
  },
  sqlite: {
    summary:
      "区分结构迁移与日常数据操作，并读懂迁移顺序、校验和及短事务的作用。",
    related: [
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "technical",
        documentId: "desktop",
      },
      {
        libraryId: "technical",
        documentId: "assets",
      },
    ],
  },
  revision: {
    summary:
      "通过两个窗口编辑同一笔记，理解 CAS、自动保存队列与历史恢复的关系。",
    related: [
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
      {
        libraryId: "technical",
        documentId: "sqlite",
      },
      {
        libraryId: "thought-workshop",
        documentId: "storage",
      },
    ],
  },
  assets: {
    summary:
      "用含图片画板的迁移说明素材引用、完整备份、Markdown 包与成品导出的区别。",
    related: [
      {
        libraryId: "technical",
        documentId: "identity",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
      {
        libraryId: "thought-workshop",
        documentId: "delivery",
      },
    ],
  },
  providers: {
    summary: "跟踪一段流式回答，区分供应商协议、公共增量事件和最终调用状态。",
    related: [
      {
        libraryId: "technical",
        documentId: "tasks",
      },
      {
        libraryId: "general",
        documentId: "testing",
      },
      {
        libraryId: "general",
        documentId: "logs",
      },
    ],
  },
  tasks: {
    summary: "区分提交中断与结果下载失败，理解为什么前者不能自动重新生成。",
    related: [
      {
        libraryId: "technical",
        documentId: "providers",
      },
      {
        libraryId: "technical",
        documentId: "visual-workshop",
      },
      {
        libraryId: "general",
        documentId: "logs",
      },
    ],
  },
  rendering: {
    summary: "从一个输出时刻出发，说明画面、源时间、音频和编码如何汇合。",
    related: [
      {
        libraryId: "technical",
        documentId: "video-editor",
      },
      {
        libraryId: "technical",
        documentId: "motion-compositor",
      },
      {
        libraryId: "technical",
        documentId: "galgame-workshop",
      },
    ],
  },
  automation: {
    summary:
      "用创建画板笔记的 SDK 实例，串起认证、版本前提、正式写入和结果确认。",
    related: [
      {
        libraryId: "technical",
        documentId: "identity",
      },
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "general",
        documentId: "automation",
      },
    ],
  },
  desktop: {
    summary: "区分桌面壳、本机后端、静态指南和用户数据，并说明受控更新的边界。",
    related: [
      {
        libraryId: "technical",
        documentId: "sqlite",
      },
      {
        libraryId: "technical",
        documentId: "automation",
      },
      {
        libraryId: "general",
        documentId: "desktop",
      },
    ],
  },
  engineering: {
    summary:
      "把画板功能从源码到离线安装包的验证，拆成契约、行为、边界和资源证据。",
    related: [
      {
        libraryId: "technical",
        documentId: "modules",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
      {
        libraryId: "technical",
        documentId: "desktop",
      },
    ],
  },
  "presentation-workshop": {
    summary: "从移动标题到导出 PPTX，理解文稿树、元素约束和格式转换的关系。",
    related: [
      {
        libraryId: "technical",
        documentId: "assets",
      },
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "presentation-workshop",
        documentId: "delivery",
      },
    ],
  },
  "thought-workshop": {
    summary:
      "解释一张可编辑画板如何成为笔记节点，并随搜索、历史、复制和导出流转。",
    related: [
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "technical",
        documentId: "assets",
      },
      {
        libraryId: "thought-workshop",
        documentId: "workflow",
      },
    ],
  },
  "visual-workshop": {
    summary:
      "把节点创作图、供应商任务和托管结果分开，说明生成与再次复用的过程。",
    related: [
      {
        libraryId: "technical",
        documentId: "tasks",
      },
      {
        libraryId: "technical",
        documentId: "providers",
      },
      {
        libraryId: "visual-workshop",
        documentId: "workflow",
      },
    ],
  },
  "galgame-workshop": {
    summary: "跟踪一次玩家选择，说明故事结构、运行状态与线性路线视频为何不同。",
    related: [
      {
        libraryId: "technical",
        documentId: "rendering",
      },
      {
        libraryId: "technical",
        documentId: "assets",
      },
      {
        libraryId: "galgame-workshop",
        documentId: "delivery",
      },
    ],
  },
  "video-editor": {
    summary:
      "用两倍速片段算出源采样位置，理解裁切、波纹编辑与渲染为何要区分三个时间坐标。",
    related: [
      {
        libraryId: "technical",
        documentId: "rendering",
      },
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "video-editor",
        documentId: "workflow",
      },
    ],
  },
  "motion-compositor": {
    summary:
      "用滑入标题说明关键帧、局部帧、遮罩与 Alpha 合成如何共同决定输出。",
    related: [
      {
        libraryId: "technical",
        documentId: "rendering",
      },
      {
        libraryId: "technical",
        documentId: "video-editor",
      },
      {
        libraryId: "motion-compositor",
        documentId: "delivery",
      },
    ],
  },
  "live2d-workshop": {
    summary:
      "跟踪头部转向参数，说明动作、关键形插值、默认姿态与多参数组合的关系。",
    related: [
      {
        libraryId: "technical",
        documentId: "desktop-pet",
      },
      {
        libraryId: "technical",
        documentId: "rendering",
      },
      {
        libraryId: "live2d-workshop",
        documentId: "delivery",
      },
    ],
  },
  "desktop-pet": {
    summary:
      "解释固定 Live2D 快照怎样隔离源工程变化，以及显式同步为何需要重新验证。",
    related: [
      {
        libraryId: "technical",
        documentId: "live2d-workshop",
      },
      {
        libraryId: "technical",
        documentId: "desktop",
      },
      {
        libraryId: "desktop-pet",
        documentId: "workflow",
      },
    ],
  },
  "audio-annotation": {
    summary:
      "以交接说话人与重叠语音为例，理解毫秒区间、多说话人标签和转写校对。",
    related: [
      {
        libraryId: "technical",
        documentId: "providers",
      },
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "audio-annotation",
        documentId: "delivery",
      },
    ],
  },
  "director-desk": {
    summary:
      "通过演员走到桌边的一次预演，串起对象状态、动作路径、摄影机与工程保存。",
    related: [
      {
        libraryId: "technical",
        documentId: "rendering",
      },
      {
        libraryId: "technical",
        documentId: "automation",
      },
      {
        libraryId: "director-desk",
        documentId: "storage",
      },
    ],
  },
};
