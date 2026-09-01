import type { GuidePage } from "./types";

const videoEditorProjects: GuidePage = {
  id: "video-editor-projects",
  group: "视频剪辑工坊",
  title: "剪辑工程、快照与素材",
  eyebrow: "VIDEO PROJECTS & ASSETS",
  lead: "每个剪辑工程拥有独立时间线、素材快照、代理缓存和导出目录，并始终受当前 Workspace 隔离。",
  sections: [
    {
      id: "project-lifecycle",
      title: "创建、携带与恢复工程",
      steps: [
        "从 AI 应用进入视频剪辑工坊，点击“新建剪辑”后直接打开时间线。",
        "项目卡片支持重命名、删除、打开运行主机上的项目目录，以及导出版本 1 的项目快照 ZIP。",
        "导入快照会先验证结构和素材，再创建独立副本；不会覆盖现有工程或沿用原工程 ID。",
        "快照包含可编辑时间线和所需原素材，不包含代理、波形、缩略图、任务历史或已经生成的成片。",
      ],
      image: {
        src: "/docs/video-editor-projects.jpg",
        alt: "视频剪辑工坊项目列表，展示剪辑工程与快照操作",
        caption: "项目列表统一提供导入、导出、重命名、删除和打开项目目录操作。",
      },
    },
    {
      id: "assets-and-proxies",
      title: "导入素材并确认代理状态",
      bullets: [
        "可以上传本地素材，也可以从当前 Workspace 的文件管理、视觉项目或 Galgame 项目导入独立副本。",
        "图片、视频和音频会保留原素材；缩略图、视频代理、波形等仅是可重建的派生缓存。",
        "素材卡显示类型和代理状态。代理失败时可重试；删除前必须先移除所有时间线引用。",
        "正式精确预览、片段导出和完整渲染读取原素材与不可变时间线快照，不以浏览器录屏或代理文件作为最终真源。",
      ],
    },
  ],
};

const videoEditorTimeline: GuidePage = {
  id: "video-editor-timeline",
  group: "视频剪辑工坊",
  title: "多轨时间线与精确预览",
  eyebrow: "TIMELINE & PREVIEW",
  lead: "以微秒级时间线组织视频、图片、声音、黑幕和文字卡，并用后端确定性帧检查最终画面。",
  sections: [
    {
      id: "timeline-editing",
      title: "搭建和编辑时间线",
      steps: [
        "双击素材把它加入兼容轨道；也可以添加纯色黑幕和文字卡。",
        "选择片段后移动、裁切、分割或删除；同一次操作批次通过 revision CAS 保存，冲突时重新载入服务器快照。",
        "时间标尺和播放头用于定位。浏览器代理适合流畅预览，后端精确帧用于核对指定时间点的最终像素结果。",
        "关联片段共享来源关系，但每个时间线片段仍拥有自己的入点、出点、位置和表现参数；修改时先确认当前选中项。",
      ],
      image: {
        src: "/docs/video-editor-timeline.jpg",
        alt: "视频剪辑工坊的素材区、预览器和多轨时间线",
        caption:
          "素材、预览和多轨时间线位于同一工作区；精确帧与正式渲染共用后端渲染契约。",
      },
    },
    {
      id: "exact-preview",
      title: "代理预览与精确帧的边界",
      table: {
        headers: ["能力", "适用场景", "结果"],
        rows: [
          [
            "浏览器代理预览",
            "快速播放、拖动和粗剪",
            "优先流畅，不作为成片验收真源",
          ],
          [
            "后端精确帧",
            "检查切点、文字、缩放和叠放",
            "按当前 revision 和时间点确定性输出 PNG",
          ],
          ["完整渲染", "交付成片", "固定快照、固定帧网格和音频 PTS 的 MP4"],
        ],
      },
      note: "精确帧提示版本过期时，先等待保存完成并重新请求；不要用旧 revision 的图片判断当前时间线。",
    },
  ],
};

const videoEditorDelivery: GuidePage = {
  id: "video-editor-delivery",
  group: "视频剪辑工坊",
  title: "片段导出、完整渲染与失败恢复",
  eyebrow: "EXPORT & RECOVERY",
  lead: "先预检不可变时间线快照，再选择片段交接或完整成片；任务可以离开页面继续运行并安全取消。",
  sections: [
    {
      id: "segment-export",
      title: "导出关联片段",
      bullets: [
        "片段导出用于把选定时间范围生成独立片段，并可交接到新的视觉项目；名称和范围在提交时固定。",
        "跨项目交接只使用当前 Workspace 内已验证的目标工程；其他 Workspace 的项目或任务 ID 会按不存在处理。",
        "列表会显示各片段准备、渲染、保存和失败状态；取消只影响当前任务，不修改时间线。",
      ],
    },
    {
      id: "render-preflight",
      title: "预检并开始完整渲染",
      steps: [
        "点击“导出视频”，选择 720p30、1080p30 或 1080p60 预设，并确认起止范围。",
        "先运行预检，处理缺失原素材、非法范围、版本过期、磁盘空间或编码能力问题。",
        "预检通过后提交确定性渲染。任务从数据库记录恢复 Workspace 和冻结快照，离开页面不会改变租户归属。",
        "完成后从任务记录下载 MP4；取消中的任务会在安全边界停止，提交阶段中断不会自动重复提交。",
      ],
    },
    {
      id: "failure-recovery",
      title: "失败恢复顺序",
      table: {
        headers: ["现象", "先检查", "恢复动作"],
        rows: [
          [
            "素材或代理失败",
            "原文件是否仍在、格式是否受支持",
            "重试代理；原文件失效时重新导入并替换引用",
          ],
          [
            "预检版本过期",
            "页面是否仍在保存",
            "等待保存完成，重新打开导出并再次预检",
          ],
          [
            "编码器不可用",
            "FFmpeg/FFprobe 与 H.264、AAC 能力",
            "补齐系统编码能力后新建任务",
          ],
          [
            "任务失败或被取消",
            "任务阶段与错误摘要",
            "修正原因后显式重建；系统不会静默覆盖或自动重提",
          ],
        ],
      },
    },
  ],
};

export const VIDEO_EDITOR_GUIDES = [
  videoEditorProjects,
  videoEditorTimeline,
  videoEditorDelivery,
];
