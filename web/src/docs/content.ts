export type GuideImage = {
  src: string;
  alt: string;
  caption: string;
};

export type GuideTable = {
  headers: string[];
  rows: string[][];
};

export type GuideSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  note?: string;
  table?: GuideTable;
  image?: GuideImage;
};

export type GuidePage = {
  id: string;
  group: "开始使用" | "视觉创作工坊" | "Galgame 工坊";
  title: string;
  eyebrow: string;
  lead: string;
  sections: GuideSection[];
};

export type GuideGroup = {
  title: GuidePage["group"];
  pages: GuidePage[];
};

const overview: GuidePage = {
  id: "overview",
  group: "开始使用",
  title: "未来道具研究所使用指南",
  eyebrow: "DOCUMENTATION",
  lead: "从视觉素材生成到分支故事编排，这里按真实界面说明两个创作工坊的完整工作流。",
  sections: [
    {
      id: "choose-workshop",
      title: "选择创作工坊",
      paragraphs: [
        "视觉创作工坊适合组织文本、图片、视频和音频素材，并通过生成模型或创作助手扩展画布。Galgame 工坊适合维护章节、Fragment、Block、角色、场景、声音和可试玩线路。",
      ],
      table: {
        headers: ["目标", "推荐入口", "最终结果"],
        rows: [
          [
            "生成或整理视频素材",
            "视觉创作工坊",
            "项目素材、画布节点与生成任务",
          ],
          ["编写分支视觉小说", "Galgame 工坊", "可试玩故事、时间轴与线路报告"],
          ["验证模型是否可用", "Studio 模型服务", "独立的模型测试记录"],
        ],
      },
    },
    {
      id: "local-first",
      title: "本地优先与自动保存",
      bullets: [
        "两个工坊都使用本机项目数据，不会自动创建云端协作空间。",
        "画布和故事采用 revision 检测并发冲突；发生冲突时先检查服务器快照，不会静默覆盖。",
        "图片和视频生成是异步任务；完成结果会进入对应项目素材库。",
        "删除仍被项目引用的素材前，需要先解除引用。",
      ],
      note: "文档以当前可见功能和实际界面为准；模型能力、时长和分辨率选项取决于已配置的生成模型。",
    },
    {
      id: "reading-path",
      title: "推荐阅读顺序",
      steps: [
        "第一次生成视频：阅读“视觉创作工坊快速开始”与“视频生成”。",
        "第一次制作 Galgame：阅读“Galgame 快速开始”与“剧本、角色、场景与声音”。",
        "需要校准整轨配音：阅读“剧情时间轴”。",
        "交付前：完成“试玩与线路检查”中的检查清单。",
      ],
    },
  ],
};

const visualQuickstart: GuidePage = {
  id: "visual-quickstart",
  group: "视觉创作工坊",
  title: "视觉创作工坊快速开始",
  eyebrow: "VISUAL WORKSHOP",
  lead: "用一个项目承载画布、私有素材、生成任务和创作助手对话。",
  sections: [
    {
      id: "create-project",
      title: "创建并进入项目",
      steps: [
        "从 AI 应用打开视觉创作工坊，点击“新建项目”。",
        "在项目卡片中打开画布；需要整理文件时进入“素材”。",
        "在画布空白处右键，添加文本、图片、视频或音频节点。",
        "拖动节点组织空间，使用右下角控制缩放或适应屏幕。",
      ],
      image: {
        src: "/docs/visual-canvas.jpg",
        alt: "视觉创作工坊画布，包含文本、图片和视频节点",
        caption:
          "画布是项目的创作工作区；节点位置、标题、内容和生成草稿都会自动保存。",
      },
    },
    {
      id: "save-state",
      title: "看懂保存状态",
      bullets: [
        "“保存中”表示本次修改正在写入项目画布。",
        "“已保存”表示当前 revision 已落盘。",
        "“存在冲突”表示另一页面更新过画布，需要选择保留本地或载入服务器版本。",
        "“保存失败”通常是服务不可用或输入不符合校验规则。",
      ],
    },
    {
      id: "first-result",
      title: "完成第一个结果",
      steps: [
        "添加图片或视频节点并选中它。",
        "在节点检查器切换到“生成”，选择模型并填写提示词。",
        "提交任务后可继续编辑画布，无需停留等待。",
        "在“生成任务”查看进度；完成的媒体会绑定到节点并进入素材库。",
      ],
    },
  ],
};

const visualCanvas: GuidePage = {
  id: "visual-canvas-assets",
  group: "视觉创作工坊",
  title: "画布与素材",
  eyebrow: "CANVAS & ASSETS",
  lead: "画布负责组织创作关系，素材库负责管理可以被节点和生成任务引用的真实文件。",
  sections: [
    {
      id: "canvas-actions",
      title: "画布常用操作",
      table: {
        headers: ["操作", "入口", "说明"],
        rows: [
          ["添加节点", "画布空白处右键", "支持文本、图片、视频和音频"],
          ["移动节点", "拖动节点卡片", "只改变画布位置，不修改素材文件"],
          [
            "复制节点",
            "选中节点后的复制按钮",
            "复制节点配置，素材仍复用同一引用",
          ],
          ["替换素材", "媒体节点上的“替换”", "从当前项目素材中重新绑定"],
          ["适应屏幕", "右下角视图控制", "把现有节点重新框入可视区域"],
        ],
      },
    },
    {
      id: "asset-sources",
      title: "素材的三种来源",
      bullets: [
        "项目私有素材：直接上传到当前项目，只在该项目内管理。",
        "公共文件：从 Studio 文件管理导入引用，原文件仍由文件管理维护。",
        "跨项目素材：从其他视觉项目复制独立副本，来源项目后续整理或删除不会影响当前项目。",
        "生成结果：图片或视频任务完成后自动加入当前项目素材库。",
      ],
      note: "引用中的公共文件或项目素材不能直接删除；先在画布、提示词引用或任务配置中解除关联。",
    },
    {
      id: "asset-drawer",
      title: "在画布内浏览素材",
      paragraphs: [
        "点击左侧素材库按钮可以在不离开画布的情况下搜索和筛选项目素材。卡片视图适合看缩略图，列表视图更适合按名称快速定位；“管理素材”会打开完整素材页面。",
      ],
    },
  ],
};

const visualVideo: GuidePage = {
  id: "visual-video",
  group: "视觉创作工坊",
  title: "视频生成",
  eyebrow: "VIDEO GENERATION",
  lead: "根据镜头目标选择纯文本、图生视频、首尾帧或参考素材模式，再由当前模型能力决定可用参数。",
  sections: [
    {
      id: "open-generator",
      title: "打开视频生成器",
      steps: [
        "在画布空白处右键添加视频节点，或选中已有视频节点。",
        "打开节点检查器的“生成”页签，确认当前类型为视频。",
        "选择可用的视频生成模型；没有模型时先回到模型服务完成配置。",
        "描述镜头主体、动作、运镜、光线和氛围，再选择输入方式。",
      ],
      image: {
        src: "/docs/visual-video-generation.jpg",
        alt: "视频节点的 AI 生成面板，展示提示词、参数和输入方式",
        caption: "生成草稿保存在节点中；刷新或离开画布后仍可继续编辑。",
      },
    },
    {
      id: "input-modes",
      title: "四种输入方式",
      table: {
        headers: ["模式", "需要的素材", "适用场景"],
        rows: [
          ["纯文本", "无需参考素材", "从描述直接生成新镜头"],
          ["图生视频", "一张起始画面", "让静态构图产生动作"],
          ["首尾帧", "必选首帧，可选尾帧", "控制镜头起点和目标画面"],
          [
            "参考素材",
            "最多 9 图、3 视频、3 音频",
            "综合借鉴角色、运动、节奏或声音",
          ],
        ],
      },
    },
    {
      id: "video-options",
      title: "参数与提交",
      bullets: [
        "时长、比例和分辨率只显示当前模型支持的取值；切换模型后应重新核对。",
        "“保留水印”控制供应商输出中的水印选项。",
        "“生成音频”请求模型同时生成声音，是否生效取决于模型能力。",
        "参考音频和视频在提交前会经过临时 HTTPS 托管；链接不会写入任务快照或调用日志。",
      ],
      note: "提交前确认提示词和素材引用。任务创建后会固定模型与参数快照，修改节点草稿不会反向改变已提交任务。",
    },
    {
      id: "prompt-pattern",
      title: "镜头描述模板",
      paragraphs: [
        "可以按“主体与环境 → 动作 → 镜头运动 → 光线与风格 → 节奏与限制”的顺序写提示词。例如：雨夜研究所走廊，调查员快步靠近闪烁的终端，镜头缓慢推进，冷蓝应急灯与浅景深，动作连贯，不改变人物服装。",
      ],
    },
  ],
};

const visualTasks: GuidePage = {
  id: "visual-tasks-assistant",
  group: "视觉创作工坊",
  title: "生成任务与创作助手",
  eyebrow: "TASKS & ASSISTANT",
  lead: "任务页负责追踪异步生成，创作助手负责理解当前画布并在确认后执行写操作。",
  sections: [
    {
      id: "task-queue",
      title: "追踪生成任务",
      paragraphs: [
        "打开工坊侧栏的“生成任务”，可以按项目、图片/视频类型和状态筛选。任务卡片展示进度、模型和提示词摘要；完成结果会自动保存到对应项目素材库。",
      ],
      image: {
        src: "/docs/visual-tasks.jpg",
        alt: "视觉创作工坊生成任务列表及筛选器",
        caption: "任务在后台轮询，离开画布不会中断已经提交的生成。",
      },
    },
    {
      id: "assistant",
      title: "使用创作助手",
      steps: [
        "在画布右上角打开“对话”，选择文本、图像和视频模型。",
        "让助手总结画布、检查素材或规划下一步；读取操作无需确认。",
        "助手准备修改画布或创建生成任务时，先查看工具步骤和影响范围。",
        "确认后执行；发生 revision 冲突时重新读取画布再继续。",
      ],
    },
    {
      id: "troubleshooting",
      title: "常见问题",
      table: {
        headers: ["现象", "检查方式"],
        rows: [
          ["没有可用视频模型", "在模型服务中检查供应商配置和视频生成模型状态"],
          ["参考素材无法提交", "确认类型正确、文件仍存在且数量未超过模式上限"],
          ["任务长时间停留", "查看任务错误信息和后端就绪状态，再决定是否重试"],
          ["结果未绑定节点", "刷新画布并确认任务属于同一项目、目标节点仍存在"],
        ],
      },
    },
  ],
};

const galgameQuickstart: GuidePage = {
  id: "galgame-quickstart",
  group: "Galgame 工坊",
  title: "Galgame 工坊快速开始",
  eyebrow: "GALGAME WORKSHOP",
  lead: "先建立最小可玩线路，再逐步补角色、场景、演出、声音和精确时间轴。",
  sections: [
    {
      id: "create-story",
      title: "创建最小可玩工程",
      steps: [
        "新建工程并进入概览，确认工程处于草稿状态。",
        "进入编辑器，为入口 Fragment 添加场景、对白或旁白。",
        "使用分支 Block 指向同章的其他 Fragment，并让每条可玩线路到达章节结局。",
        "打开试玩验证节奏，再用工程检查定位断路、不可达 Fragment 和循环。",
      ],
      image: {
        src: "/docs/galgame-overview.jpg",
        alt: "Galgame 工程概览，展示章节、角色、场景、Fragment 和结局摘要",
        caption: "工程概览把编辑入口、故事规模和线路就绪状态放在同一页面。",
      },
    },
    {
      id: "story-model",
      title: "理解章节、Fragment 与 Block",
      bullets: [
        "章节定义一段完整线路，入口 Fragment 是本章开始位置。",
        "Fragment 是分支图中的节点；分支只能指向同章存在的 Fragment。",
        "Block 按顺序描述场景切换、角色登退场、对白、声音、分支和结局。",
        "角色、场景、变量和素材使用稳定 ID，被 Block 引用后不要随意更换。",
      ],
    },
    {
      id: "autosave",
      title: "自动保存与冲突",
      paragraphs: [
        "故事以整份文档通过 revision CAS 保存。页面会显示保存中、已保存、保存失败或存在冲突；冲突时可以载入服务器快照，或在明确确认后用本地故事覆盖。任何故事修改都会把已完成工程恢复为草稿。",
      ],
    },
  ],
};

const galgameStory: GuidePage = {
  id: "galgame-story-assets",
  group: "Galgame 工坊",
  title: "剧本、角色、场景与声音",
  eyebrow: "STORY & ASSETS",
  lead: "把剧情事实、舞台状态和素材引用分开维护，才能让预览和线路检查保持确定性。",
  sections: [
    {
      id: "script-flow",
      title: "统一 Beat 编排工作台",
      paragraphs: [
        "剧本工作区左侧选择章节和 Fragment，中间上方编辑舞台或试玩、下方使用 Beat 选择带与多轨时间轴，右侧只显示属性、样式和检查。一个 Beat 可以同时包含固定场景、多名角色、声音和舞台调整；场景与在场角色等持续状态会在 Beat 检查器中汇总。",
      ],
      image: {
        src: "/docs/galgame-editor.jpg",
        alt: "Galgame 剧本编辑器，包含 Fragment、Block、属性和游戏预览",
        caption:
          "Beat 选择带表达推进段落，多轨区域表达同一时刻并行发生的舞台与声音事件。",
      },
    },
    {
      id: "characters-scenes",
      title: "角色与场景",
      bullets: [
        "角色可设置默认立绘和多种表情；对白可覆盖本句使用的表情与舞台位置。",
        "一条对白可以勾选多个同时说话角色；对话框会并列显示姓名，舞台上的这些角色会一起获得聚焦和口型响应。主角色继续承载本句表情、立绘和配音。",
        "角色登场/调整 Block 维护位置、比例、亮度、透明度、翻转、层级和过渡。",
        "场景可以有多张背景和默认背景；Scene Block 可以固定某张背景并决定是否清空角色。",
        "试玩中的拖动仅在可编辑角色状态下生效，结果仍写回所选 Block。",
      ],
    },
    {
      id: "sound-assets",
      title: "声音与参考声轨",
      bullets: [
        "voiceSample 用于角色音色样本，voiceLine 用于单句对白配音。",
        "backgroundMusic、ambientSound 和 soundEffect 由声音 Block 播放、停止和淡入淡出。",
        "timelineTrack 只是可选的校准参考；正式试玩不会播放它。对白/旁白使用 startMs 和 endMs，舞台与声音事件使用 atMs。",
        "BGM 与环境音由播放/停止事件推导持续状态；场景切换不会暗中替换它们。",
      ],
    },
  ],
};

const galgameTimeline: GuidePage = {
  id: "galgame-timeline",
  group: "Galgame 工坊",
  title: "剧情时间轴",
  eyebrow: "TIMELINE EDITING",
  lead: "像剪辑软件一样编排独立剧情时钟：场景、角色、对白、BGM、环境音和 SFX 可以在同一时刻分轨发生，参考声轨只负责校准。",
  sections: [
    {
      id: "open-timeline",
      title: "进入可视化时间轴",
      steps: [
        "所有 Fragment 都直接显示统一 Beat 时间轴，不需要先上传参考声轨。旧 Fragment 只在界面中按文本长度估时，打开本身不会保存；第一次时间编辑才物化精确时间轴。",
        "如需对齐整轨录音，再选择一条 timelineTrack 作为可独立试听的参考。",
        "Beat 选择带位于多轨区域上方；参考、场景、各角色、对白/配音、BGM、环境音、SFX 和结构标记分别占用轨道。",
        "用缩放滑杆调整每分钟像素宽度，点击标尺或空白处移动播放头。",
      ],
      image: {
        src: "/docs/galgame-timeline.jpg",
        alt: "Galgame 可编辑剧情时间轴，展示多段对白、无对白区间和波纹编辑开关",
        caption:
          "时间轴不会创建 Gap Block；所有无对白区间都由相邻对白边界和独立剧情总长推导。",
      },
    },
    {
      id: "beat-range",
      title: "连续 Beat 范围",
      bullets: [
        "普通点击选择一个 Beat；Shift 点击或横向拖动选择连续范围；Ctrl/Cmd+A 和“选择全部”覆盖整个 Fragment。",
        "单 Beat 检查器显示持续舞台状态与内部事件；多 Beat 检查器显示首尾时间、总时长和事件统计。",
        "范围可整体平移、按起点缩放、复制到范围之后或删除并闭合空隙；后续 Beat 始终按差值波纹移动。",
        "全选会包含末尾分支或结局用于统计，但结构 Beat 不会被复制、删除、移动或缩放。",
      ],
    },
    {
      id: "normal-vs-ripple",
      title: "普通裁切与波纹编辑",
      table: {
        headers: ["操作", "普通模式", "波纹编辑"],
        rows: [
          [
            "拖动对白块",
            "移动所选并补偿连续相邻块",
            "所选及全部后续对白整体移动",
          ],
          [
            "拉伸 A 的右边界",
            "调整 A/B 的共享切点",
            "改变 A 时长，B 及后续整体移动",
          ],
          ["缩短 A", "B 可扩展到新切点", "B 时长不变并前移，尾部形成空白"],
          [
            "向右拉伸",
            "受相邻对白限制；末尾 Block 可自动扩展剧情长度",
            "自动增长剧情长度，并保留原有结尾留白",
          ],
        ],
      },
      note: "波纹编辑只影响所选块的右边界和后续对白；开始边界与无对白区间仍按普通边界语义编辑。",
    },
    {
      id: "precision-tools",
      title: "精确校准工具",
      bullets: [
        "默认拖动吸附到 100ms；拖动时按住 Alt 可精确到 1ms。",
        "边界获得焦点后使用方向键每次移动 100ms，按住 Shift 每次移动 1 秒。",
        "右侧属性面板接受 mm:ss.mmm 时间码，并共享当前波纹编辑模式。",
        "“预听所选”会提前 300ms 播放；可开启循环所选反复检查切点。",
        "移动播放头后，可直接把它设为所选对白的开始或结束。",
        "工具栏会分别显示声轨长度和剧情长度；剧情长度可精确输入，若短于最后一个 Block 会自动保留到该 Block 结束。",
        "在播放头位置可以连续添加多个不同角色、声音或舞台事件；右侧检查器可精确修改 atMs。",
        "参考声轨拥有独立试听开关，正式多轨混音只播放逐句配音、BGM、环境音和 SFX。",
      ],
    },
    {
      id: "timeline-validation",
      title: "保存校验",
      bullets: [
        "起止时间必须非负、开始早于结束，单句至少保留 100ms。",
        "对白之间不能重叠，也不能超过剧情时间轴总长；向右编辑会自动扩展该总长。",
        "timeline.assetId 可省略；存在时必须引用 timelineTrack。只含参考轨而没有正式运行时声音会在线路报告中提示。",
        "同一时刻只允许一次场景切换、同一角色一次调整，以及每个持续声音通道一次播放；多个角色和多个 SFX 可以并行。",
        "所有合法修改仍通过整份 Story CAS 自动保存。",
      ],
    },
  ],
};

const galgamePreview: GuidePage = {
  id: "galgame-preview-report",
  group: "Galgame 工坊",
  title: "试玩与线路检查",
  eyebrow: "PREVIEW & ROUTE REPORT",
  lead: "试玩验证真实演出，线路检查验证结构可达性；两者都通过后再把工程标记为完成。",
  sections: [
    {
      id: "preview",
      title: "编辑预览与完整试玩",
      bullets: [
        "编辑模式会把当前 Fragment、所选 Block 或时间轴播放头同步到中间上方舞台；舞台和时间轴高度可拖动调整并保存在浏览器。",
        "试玩时下方时间轴自动切换到当前 Fragment，以只读方式跟随 Beat 和精确播放头；退出试玩后恢复原来的编辑选择。",
        "试玩默认手动推进，也可切换自动播放；偏好只保存在玩家本地，不会改写故事。",
        "手动模式在当前 Beat 内正常演出并于末尾等待点击；自动模式沿同一时间轴连续推进，选择出现时两者都会暂停。",
        "首次点击会先完成尚未显示完的文字或转场，再次点击才跳到下一 Beat；跳转会重建舞台与持续声音状态，不补播中间 SFX。",
        "时间轴 Fragment 使用独立剧情时钟切换对白和舞台事件；参考声轨不进入正式试玩混音。",
        "浏览器首次播放声音可能需要一次明确点击授权。",
      ],
      image: {
        src: "/docs/galgame-player-report.jpg",
        alt: "Galgame 游戏预览和工程线路检查报告",
        caption: "试玩负责感受节奏，线路报告负责证明入口、分支和结局结构完整。",
      },
    },
    {
      id: "route-report",
      title: "读懂线路报告",
      table: {
        headers: ["结果", "含义", "处理方式"],
        rows: [
          ["开放断点", "Fragment 没有分支或结局", "补充分支或 endChapter"],
          ["不可达 Fragment", "入口没有路径到达", "补充分支引用或删除孤立内容"],
          [
            "悬空引用",
            "目标 Fragment、角色、场景或素材不存在",
            "选择有效目标或恢复实体",
          ],
          ["循环", "线路可能反复跳转", "确认是设计需要，否则增加退出分支"],
          ["结局不足", "章节缺少可达结局", "补充并连接至少一个章节结局"],
        ],
      },
    },
    {
      id: "delivery-checklist",
      title: "完成前检查清单",
      steps: [
        "从章节入口试玩每个选择，确认角色、背景、声音和变量状态正确。",
        "检查每条时间轴对白切点和开场/结尾无对白区间。",
        "打开完整线路报告，解释或修复不可达 Fragment 与循环。",
        "确认至少一个结局可达且报告处于就绪状态，再标记工程完成。",
      ],
    },
  ],
};

export const GUIDE_GROUPS: GuideGroup[] = [
  { title: "开始使用", pages: [overview] },
  {
    title: "视觉创作工坊",
    pages: [visualQuickstart, visualCanvas, visualVideo, visualTasks],
  },
  {
    title: "Galgame 工坊",
    pages: [galgameQuickstart, galgameStory, galgameTimeline, galgamePreview],
  },
];

export const GUIDE_PAGES = GUIDE_GROUPS.flatMap((group) => group.pages);

export function guideSearchText(page: GuidePage) {
  return [
    page.title,
    page.group,
    page.lead,
    ...page.sections.flatMap((section) => [
      section.title,
      ...(section.paragraphs ?? []),
      ...(section.steps ?? []),
      ...(section.bullets ?? []),
      section.note ?? "",
      ...(section.table?.headers ?? []),
      ...(section.table?.rows.flat() ?? []),
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}
