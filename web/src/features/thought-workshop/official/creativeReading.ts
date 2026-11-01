export const CREATIVE_READING: Record<
  string,
  {
    summary: string;
    related: readonly { libraryId: string; documentId: string }[];
  }
> = {
  "motion-compositor/overview": {
    summary: "从一段滑入片名开始，创建二维图层、记录位置动画并下载无声镜头。",
    related: [
      { libraryId: "motion-compositor", documentId: "workflow" },
      { libraryId: "motion-compositor", documentId: "delivery" },
    ],
  },
  "motion-compositor/workflow": {
    summary: "先验证静态构图，再按图层局部时间组织关键帧与路径遮罩。",
    related: [
      { libraryId: "motion-compositor", documentId: "storage" },
      { libraryId: "motion-compositor", documentId: "help" },
    ],
  },
  "motion-compositor/storage": {
    summary:
      "替换媒体时保留工程结构，分清保存版本、固定导出快照与剪辑里的媒体副本。",
    related: [
      { libraryId: "motion-compositor", documentId: "delivery" },
      { libraryId: "technical", documentId: "assets" },
    ],
  },
  "motion-compositor/delivery": {
    summary:
      "按继续编辑、常规播放、透明叠加或逐帧交付选择格式，并发送完成镜头到剪辑。",
    related: [
      { libraryId: "motion-compositor", documentId: "storage" },
      { libraryId: "video-editor", documentId: "workflow" },
    ],
  },
  "motion-compositor/help": {
    summary: "从无声输出、透明背景、动画停止和遮罩跳动定位最小修复范围。",
    related: [
      { libraryId: "motion-compositor", documentId: "workflow" },
      { libraryId: "motion-compositor", documentId: "delivery" },
    ],
  },
  "audio-annotation/overview": {
    summary:
      "用一段双人访谈建立时间、人物与正文对应关系，完成第一份可交接标注。",
    related: [
      { libraryId: "audio-annotation", documentId: "workflow" },
      { libraryId: "audio-annotation", documentId: "delivery" },
    ],
  },
  "audio-annotation/workflow": {
    summary: "校准片段边界，处理多人发言和逐人情绪，再核对语言正文与校对状态。",
    related: [
      { libraryId: "audio-annotation", documentId: "storage" },
      { libraryId: "audio-annotation", documentId: "help" },
    ],
  },
  "audio-annotation/storage": {
    summary:
      "将项目 JSON 与对应录音成对保留，理解阶段工作稿、文本回填和任务删除范围。",
    related: [
      { libraryId: "audio-annotation", documentId: "delivery" },
      { libraryId: "technical", documentId: "assets" },
    ],
  },
  "audio-annotation/delivery": {
    summary: "分别交付完整标注与 SRT 字幕，按严格匹配规则回填外部修订文本。",
    related: [
      { libraryId: "audio-annotation", documentId: "workflow" },
      { libraryId: "audio-annotation", documentId: "help" },
    ],
  },
  "audio-annotation/help": {
    summary:
      "定位字幕遗漏、录音错位、文本匹配和模型输入问题，修复后回到音频试听。",
    related: [
      { libraryId: "audio-annotation", documentId: "workflow" },
      { libraryId: "audio-annotation", documentId: "delivery" },
    ],
  },
  "director-desk/overview": {
    summary:
      "用演员进门到桌边的简单场景，建立戏段、走位与正式摄影机的预演闭环。",
    related: [
      { libraryId: "director-desk", documentId: "workflow" },
      { libraryId: "director-desk", documentId: "delivery" },
    ],
  },
  "director-desk/workflow": {
    summary: "先搭景、再安排演员、最后检查运镜，区分观察视角与最终拍摄画面。",
    related: [
      { libraryId: "director-desk", documentId: "storage" },
      { libraryId: "director-desk", documentId: "help" },
    ],
  },
  "director-desk/storage": {
    summary:
      "保存戏段、对象、轨道与资源引用，留住可编辑工程并处理版本和加载异常。",
    related: [
      { libraryId: "director-desk", documentId: "delivery" },
      { libraryId: "technical", documentId: "revision" },
    ],
  },
  "director-desk/delivery": {
    summary:
      "分别交付工程包和预演视频，并为外部 Agent 打开正确的编辑器执行场景操作。",
    related: [
      { libraryId: "director-desk", documentId: "storage" },
      { libraryId: "technical", documentId: "automation" },
    ],
  },
  "director-desk/help": {
    summary:
      "按戏段、时间、对象和机位检查画面异常，处理遮挡、动作适配与 Agent 连接。",
    related: [
      { libraryId: "director-desk", documentId: "workflow" },
      { libraryId: "director-desk", documentId: "delivery" },
    ],
  },
};
