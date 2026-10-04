/** Reading context for the bundled technical documentation. */
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
      {
        libraryId: "technical",
        documentId: "scope",
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
      {
        libraryId: "technical",
        documentId: "backend-design",
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
      {
        libraryId: "technical",
        documentId: "data-model",
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
      {
        libraryId: "technical",
        documentId: "decisions",
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
      {
        libraryId: "technical",
        documentId: "frontend-design",
      },
    ],
  },
  assets: {
    summary:
      "追踪一张画板图片从上传到正文引用与鉴权预览，明确文件、素材身份和显示 URL 的生命周期。",
    related: [
      {
        libraryId: "technical",
        documentId: "data-model",
      },
      {
        libraryId: "technical",
        documentId: "data-exchange",
      },
      {
        libraryId: "technical",
        documentId: "identity",
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
      {
        libraryId: "technical",
        documentId: "contracts",
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
      {
        libraryId: "technical",
        documentId: "backend-design",
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
      {
        libraryId: "technical",
        documentId: "app-handoffs",
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
      {
        libraryId: "technical",
        documentId: "contracts",
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
      {
        libraryId: "technical",
        documentId: "scope",
      },
    ],
  },
  engineering: {
    summary:
      "沿画板保存、图片生成与视频输出建立验证证据，区分契约、行为、边界和交付检查。",
    related: [
      {
        libraryId: "technical",
        documentId: "contracts",
      },
      {
        libraryId: "technical",
        documentId: "decisions",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
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
      {
        libraryId: "technical",
        documentId: "data-exchange",
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
      {
        libraryId: "technical",
        documentId: "component-contracts",
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
      {
        libraryId: "technical",
        documentId: "frontend-design",
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
      {
        libraryId: "technical",
        documentId: "app-handoffs",
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
      {
        libraryId: "technical",
        documentId: "data-exchange",
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
      {
        libraryId: "technical",
        documentId: "app-handoffs",
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
      {
        libraryId: "technical",
        documentId: "component-contracts",
      },
    ],
  },
  "desktop-pet": {
    summary:
      "解释桌宠素材与固定 Live2D 快照、预览租约、动作运行和独立聊天请求怎样协作。",
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
      {
        libraryId: "technical",
        documentId: "app-handoffs",
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
      {
        libraryId: "technical",
        documentId: "data-model",
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
      {
        libraryId: "technical",
        documentId: "frontend-design",
      },
    ],
  },
  scope: {
    summary:
      "明确单机、多账号和逻辑 Workspace 的边界，找到适合当前问题的阅读路径。",
    related: [
      {
        libraryId: "technical",
        documentId: "system",
      },
      {
        libraryId: "technical",
        documentId: "modules",
      },
      {
        libraryId: "technical",
        documentId: "decisions",
      },
    ],
  },
  "frontend-design": {
    summary:
      "沿画板编辑拆开业务组件、服务器缓存、本机草稿和临时视图，理解前端状态归属。",
    related: [
      {
        libraryId: "technical",
        documentId: "component-contracts",
      },
      {
        libraryId: "technical",
        documentId: "revision",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
    ],
  },
  "backend-design": {
    summary:
      "跟踪笔记保存如何通过路由进入功能用例，区分校验、短事务和共享能力。",
    related: [
      {
        libraryId: "technical",
        documentId: "modules",
      },
      {
        libraryId: "technical",
        documentId: "identity",
      },
      {
        libraryId: "technical",
        documentId: "sqlite",
      },
    ],
  },
  "component-contracts": {
    summary:
      "用画板场景与异步保存解释输入输出、状态所有权、取消和组件替换的边界。",
    related: [
      {
        libraryId: "technical",
        documentId: "frontend-design",
      },
      {
        libraryId: "technical",
        documentId: "backend-design",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
    ],
  },
  "app-handoffs": {
    summary:
      "区分公共媒体能力与应用交接，追踪片段、成片和固定角色快照怎样形成目标数据。",
    related: [
      {
        libraryId: "technical",
        documentId: "rendering",
      },
      {
        libraryId: "technical",
        documentId: "desktop-pet",
      },
      {
        libraryId: "technical",
        documentId: "visual-workshop",
      },
    ],
  },
  "data-model": {
    summary:
      "从账号到项目、笔记、素材和任务逐层定位数据，区分租户归属与内容包含。",
    related: [
      {
        libraryId: "technical",
        documentId: "identity",
      },
      {
        libraryId: "technical",
        documentId: "assets",
      },
      {
        libraryId: "technical",
        documentId: "thought-workshop",
      },
    ],
  },
  "data-exchange": {
    summary:
      "用含图片笔记的迁移与视频交付，解释包校验、身份重映射、文件准备和失败补偿。",
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
        libraryId: "technical",
        documentId: "rendering",
      },
    ],
  },
  contracts: {
    summary:
      "追踪一个 API 字段如何进入 OpenAPI、Web 和独立 SDK，理解生成检查与行为验证的区别。",
    related: [
      {
        libraryId: "technical",
        documentId: "automation",
      },
      {
        libraryId: "technical",
        documentId: "engineering",
      },
      {
        libraryId: "technical",
        documentId: "backend-design",
      },
    ],
  },
  decisions: {
    summary:
      "结合当前实现解释单机、功能切片、CAS 和统一任务驱动的收益、代价与验证边界。",
    related: [
      {
        libraryId: "technical",
        documentId: "scope",
      },
      {
        libraryId: "technical",
        documentId: "modules",
      },
      {
        libraryId: "technical",
        documentId: "tasks",
      },
    ],
  },
};
