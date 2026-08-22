import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  CURTAIN_MODE_OPTIONS,
  WAIT_DURATION_PRESETS,
} from "@features/galgame-workshop/editor/blockRegistry";

import {
  audioRole,
  bool,
  cgOverlay,
  cgTransition,
  characterTransform,
  characterTransition,
  durationOptions,
  option,
  section,
  type Context,
  type BlockContextSettings,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";

const registry = {
  narration: (block) => ({
    includeInspector: true,
    sections: [
      section("旁白设置", [
        bool(
          block,
          "hide-dialogue",
          "本句后隐藏对话框",
          block.hideDialogueAfter ?? false,
          "切换旁白结束后是否隐藏对话框。",
          (current, value) => ({ ...current, hideDialogueAfter: value }),
        ),
      ]),
    ],
  }),
  dialogue: (block) => {
    const portraitMode = block.portrait?.mode ?? "legacy";
    const portraitModes = [
      ["legacy", "兼容模式"],
      ["stage", "舞台立绘"],
      ["dialogueAvatar", "对白头像"],
      ["soloLegacy", "单人特写"],
    ] as const;
    return {
      includeInspector: true,
      sections: [
        section(
          "立绘模式",
          portraitModes.map(([mode, label]) =>
            option(
              block,
              `portrait-${mode}`,
              label,
              portraitMode === mode,
              `将当前对白的立绘演出设置为“${label}”。`,
              (current) =>
                mode === "legacy"
                  ? { ...current, portrait: null }
                  : {
                      ...current,
                      portrait: {
                        mode,
                        visible: true,
                        keepAfter: mode === "stage",
                        skinId: current.portrait?.skinId ?? null,
                        transform: current.portrait?.transform ?? null,
                        transition: current.portrait?.transition ?? {
                          durationMs: 240,
                          fade: true,
                        },
                      },
                    },
            ),
          ),
        ),
        ...(block.portrait
          ? [
              section("立绘状态", [
                bool(
                  block,
                  "portrait-visible",
                  "显示立绘或头像",
                  block.portrait.visible !== false,
                  "切换当前对白是否显示立绘或对白头像。",
                  (current, value) => ({
                    ...current,
                    portrait: current.portrait
                      ? { ...current.portrait, visible: value }
                      : current.portrait,
                  }),
                ),
                ...(block.portrait.mode === "stage"
                  ? [
                      bool(
                        block,
                        "portrait-keep",
                        "对白后保留角色",
                        block.portrait.keepAfter,
                        "切换对白结束后是否保留舞台角色。",
                        (current, value) => ({
                          ...current,
                          portrait: current.portrait
                            ? { ...current.portrait, keepAfter: value }
                            : current.portrait,
                        }),
                      ),
                    ]
                  : []),
              ]),
            ]
          : []),
        section("对白状态", [
          bool(
            block,
            "hide-dialogue",
            "本句后隐藏对话框",
            block.hideDialogueAfter ?? false,
            "切换本句对白结束后是否隐藏对话框。",
            (current, value) => ({ ...current, hideDialogueAfter: value }),
          ),
        ]),
        section(
          "配音音量",
          [50, 70, 100].map((volume) =>
            option(
              block,
              `voice-volume-${volume}`,
              `${volume}%`,
              block.voiceVolume === volume,
              `将本句配音音量设置为 ${volume}%。`,
              (current) => ({ ...current, voiceVolume: volume }),
            ),
          ),
        ),
      ],
    };
  },
  storyParagraph: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "文字速度",
        [0, 15, 30, 60].map((speed) =>
          option(
            block,
            `speed-${speed}`,
            speed === 0 ? "跟随全局" : `${speed} 字/秒`,
            block.textSpeedCps === speed,
            `将段落文字速度设置为${speed === 0 ? "跟随全局" : `每秒 ${speed} 字`}。`,
            (current) => ({ ...current, textSpeedCps: speed }),
          ),
        ),
      ),
    ],
  }),
  paragraphParams: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "呈现效果",
        (["typewriter", "fade", "instant"] as const).map((value) =>
          option(
            block,
            `reveal-${value}`,
            { typewriter: "逐字显示", fade: "淡入显示", instant: "立即显示" }[
              value
            ],
            block.revealEffect === value,
            "设置后续段落的文字呈现效果。",
            (current) => ({ ...current, revealEffect: value }),
          ),
        ),
      ),
      section(
        "已读行为",
        (["inherit", "dim", "keep"] as const).map((value) =>
          option(
            block,
            `read-${value}`,
            { inherit: "继承样式", dim: "已读变暗", keep: "保持原样" }[value],
            block.readBehavior === value,
            "设置后续已读段落的显示行为。",
            (current) => ({ ...current, readBehavior: value }),
          ),
        ),
      ),
      section(
        "淡入时长",
        durationOptions(
          block,
          block.fadeMs,
          [0, 200, 500, 1000],
          (current, fadeMs) => ({
            ...current,
            fadeMs,
          }),
        ),
      ),
      section(
        "保留段落",
        [0, 3, 5, 10].map((historyLimit) =>
          option(
            block,
            `history-${historyLimit}`,
            historyLimit === 0 ? "不限制" : `${historyLimit} 段`,
            block.historyLimit === historyLimit,
            "设置画面中保留的已读段落数量。",
            (current) => ({ ...current, historyLimit }),
          ),
        ),
      ),
    ],
  }),
  systemMessage: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "消息模式",
        (["alert", "confirm"] as const).map((mode) =>
          option(
            block,
            `mode-${mode}`,
            mode === "alert" ? "提示" : "确认 / 取消",
            block.mode === mode,
            "切换系统消息的交互模式。",
            (current) => ({
              ...current,
              mode,
              resultVariableId:
                mode === "alert" ? null : current.resultVariableId,
            }),
          ),
        ),
      ),
      section(
        "语义颜色",
        (["info", "success", "warning", "danger"] as const).map((tone) =>
          option(
            block,
            `tone-${tone}`,
            { info: "信息", success: "成功", warning: "警告", danger: "危险" }[
              tone
            ],
            block.tone === tone,
            "切换系统消息的语义颜色。",
            (current) => ({ ...current, tone }),
          ),
        ),
      ),
    ],
  }),
  comment: () => ({ sections: [], includeInspector: true }),
  wait: (block) => ({
    includeInspector: false,
    sections: [
      section("等待模式", [
        option(
          block,
          "mode-duration",
          "等待指定时间",
          block.mode === "duration",
          "按毫秒时长暂停剧情；跳过模式可以越过。",
          (current) => ({
            ...current,
            mode: "duration",
            durationMs: current.durationMs ?? 1000,
          }),
        ),
        option(
          block,
          "mode-player",
          "等待玩家继续",
          block.mode === "player",
          "只响应玩家继续操作，不受自动播放或跳过影响。",
          (current) => ({ ...current, mode: "player", durationMs: null }),
        ),
      ]),
      section(
        "等待时长",
        WAIT_DURATION_PRESETS.map((durationMs) =>
          option(
            block,
            `duration-${durationMs}`,
            `${durationMs}ms`,
            block.mode === "duration" && block.durationMs === durationMs,
            `等待 ${durationMs}ms 后继续剧情。`,
            (current) => ({
              ...current,
              mode: "duration",
              durationMs,
            }),
          ),
        ),
      ),
    ],
  }),
  scene: (block) => ({
    includeInspector: true,
    sections: [
      section("场景设置", [
        bool(
          block,
          "clear-characters",
          "切换时清空角色",
          block.clearCharacters !== false,
          "切换场景时同步清空舞台角色。",
          (current, value) => ({ ...current, clearCharacters: value }),
        ),
      ]),
    ],
  }),
  destroyScene: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "清场时长",
        durationOptions(
          block,
          block.durationMs,
          [0, 200, 400, 1000],
          (current, durationMs) => ({
            ...current,
            durationMs,
          }),
        ),
      ),
      section("执行方式", [
        bool(
          block,
          "wait",
          "等待清场完成",
          block.waitForCompletion,
          "切换是否等待清场动画完成后继续。",
          (current, value) => ({ ...current, waitForCompletion: value }),
        ),
      ]),
    ],
  }),
  showCharacter: (block) => ({
    includeInspector: true,
    sections: [
      section("立绘外观", [
        bool(
          block,
          "flip",
          "水平翻转",
          characterTransform(block.transform).flipX,
          "切换角色立绘的水平方向。",
          (current, value) => ({
            ...current,
            transform: {
              ...characterTransform(current.transform),
              flipX: value,
            },
          }),
        ),
        bool(
          block,
          "fade",
          "淡入登场",
          characterTransition(block.transition).fade,
          "切换角色登场时的淡入过渡。",
          (current, value) => ({
            ...current,
            transition: {
              ...characterTransition(current.transition),
              fade: value,
            },
          }),
        ),
      ]),
      section(
        "过渡时长",
        durationOptions(
          block,
          characterTransition(block.transition).durationMs,
          [0, 120, 240, 500],
          (current, durationMs) => ({
            ...current,
            transition: {
              ...characterTransition(current.transition),
              durationMs,
            },
          }),
        ),
      ),
    ],
  }),
  setStageCast: () => ({
    includeInspector: true,
    sections: [],
  }),
  removeCharacter: (block) => ({
    includeInspector: true,
    sections: [
      section("退场效果", [
        bool(
          block,
          "fade",
          "淡出退场",
          characterTransition(block.transition).fade,
          "切换角色退场时的淡出过渡。",
          (current, value) => ({
            ...current,
            transition: {
              ...characterTransition(current.transition),
              fade: value,
            },
          }),
        ),
      ]),
      section(
        "过渡时长",
        durationOptions(
          block,
          characterTransition(block.transition).durationMs,
          [0, 120, 240, 500],
          (current, durationMs) => ({
            ...current,
            transition: {
              ...characterTransition(current.transition),
              durationMs,
            },
          }),
        ),
      ),
    ],
  }),
  showCg: (block) => ({
    includeInspector: true,
    sections: [
      section("显示模式", [
        option(
          block,
          "mode-fullscreen",
          "全屏 CG",
          block.displayMode === "fullscreen",
          "将剧情 CG 显示为全屏画面。",
          (current) => ({ ...current, displayMode: "fullscreen" }),
        ),
        option(
          block,
          "mode-overlay",
          "叠加 CG",
          block.displayMode === "overlay",
          "将剧情 CG 显示为舞台叠加层。",
          (current) => ({ ...current, displayMode: "overlay" }),
        ),
      ]),
      ...(block.displayMode === "fullscreen"
        ? [
            section(
              "画面适配",
              (["cover", "contain"] as const).map((fit) =>
                option(
                  block,
                  `fit-${fit}`,
                  fit === "cover" ? "铺满裁切" : "完整显示",
                  block.fit === fit,
                  "设置全屏 CG 的画面适配方式。",
                  (current) => ({ ...current, fit }),
                ),
              ),
            ),
          ]
        : [
            section(
              "叠放层级",
              (["behindCharacters", "frontOfCharacters"] as const).map(
                (placement) =>
                  option(
                    block,
                    `placement-${placement}`,
                    placement === "behindCharacters" ? "角色后方" : "角色前方",
                    cgOverlay(block.overlay).placement === placement,
                    "设置叠加 CG 与舞台角色的前后关系。",
                    (current) => ({
                      ...current,
                      overlay: { ...cgOverlay(current.overlay), placement },
                    }),
                  ),
              ),
            ),
          ]),
      section("过渡效果", [
        bool(
          block,
          "fade",
          "淡入 CG",
          cgTransition(block.transition).fade,
          "切换 CG 的淡入过渡。",
          (current, value) => ({
            ...current,
            transition: { ...cgTransition(current.transition), fade: value },
          }),
        ),
      ]),
      section(
        "过渡时长",
        durationOptions(
          block,
          cgTransition(block.transition).durationMs,
          [0, 200, 400, 1000],
          (current, durationMs) => ({
            ...current,
            transition: { ...cgTransition(current.transition), durationMs },
          }),
        ),
      ),
    ],
  }),
  hideCg: (block) => ({
    includeInspector: false,
    sections: [
      section("过渡效果", [
        bool(
          block,
          "fade",
          "淡出 CG",
          cgTransition(block.transition).fade,
          "切换隐藏 CG 时的淡出过渡。",
          (current, value) => ({
            ...current,
            transition: { ...cgTransition(current.transition), fade: value },
          }),
        ),
      ]),
      section(
        "过渡时长",
        durationOptions(
          block,
          cgTransition(block.transition).durationMs,
          [0, 200, 400, 1000],
          (current, durationMs) => ({
            ...current,
            transition: { ...cgTransition(current.transition), durationMs },
          }),
        ),
      ),
    ],
  }),
  camera: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "镜头目标",
        (["stage", "background", "characters", "cg"] as const).map((target) =>
          option(
            block,
            `target-${target}`,
            {
              stage: "整个舞台",
              background: "背景",
              characters: "角色",
              cg: "CG",
            }[target],
            block.target === target,
            "设置镜头效果的目标图层。",
            (current) => ({ ...current, target }),
          ),
        ),
      ),
      section(
        "常用效果",
        (
          [
            "move",
            "zoomIn",
            "zoomOut",
            "shake",
            "fadeWhite",
            "fadeBlack",
          ] as const
        ).map((effect) =>
          option(
            block,
            `effect-${effect}`,
            {
              move: "移动",
              zoomIn: "推进",
              zoomOut: "拉远",
              shake: "震动",
              fadeWhite: "闪白",
              fadeBlack: "闪黑",
            }[effect],
            block.effect === effect,
            "切换当前镜头的常用效果。",
            (current) => ({ ...current, effect }),
          ),
        ),
      ),
      section(
        "缓动",
        (["linear", "easeIn", "easeOut", "easeInOut"] as const).map((easing) =>
          option(
            block,
            `easing-${easing}`,
            {
              linear: "线性",
              easeIn: "加速",
              easeOut: "减速",
              easeInOut: "平滑",
            }[easing],
            block.easing === easing,
            "设置镜头动画的缓动曲线。",
            (current) => ({ ...current, easing }),
          ),
        ),
      ),
      section(
        "动作时长",
        durationOptions(
          block,
          block.durationMs,
          [0, 300, 500, 1000],
          (current, durationMs) => ({
            ...current,
            durationMs,
          }),
        ),
      ),
      section("执行方式", [
        bool(
          block,
          "wait",
          "等待镜头完成",
          block.waitForCompletion,
          "切换是否等待镜头动画完成后继续。",
          (current, value) => ({ ...current, waitForCompletion: value }),
        ),
      ]),
    ],
  }),
  resetCamera: (block) => ({
    includeInspector: false,
    sections: [
      section(
        "复位时长",
        durationOptions(
          block,
          block.durationMs,
          [0, 200, 300, 500],
          (current, durationMs) => ({
            ...current,
            durationMs,
          }),
        ),
      ),
      section("执行方式", [
        bool(
          block,
          "wait",
          "等待复位完成",
          block.waitForCompletion,
          "切换是否等待镜头复位完成后继续。",
          (current, value) => ({ ...current, waitForCompletion: value }),
        ),
      ]),
    ],
  }),
  audio: (block, { story }) => {
    const compatibleAssets = (channel: typeof block.channel) =>
      (story.assets ?? []).filter(
        (asset) => asset.type === "audio" && asset.role === audioRole[channel],
      );
    return {
      includeInspector: true,
      sections: [
        section("声音动作", [
          option(
            block,
            "action-play",
            "播放 / 切换",
            block.action === "play",
            "播放当前声音通道；没有兼容素材时不可用。",
            (current) => ({
              ...current,
              action: "play",
              assetId:
                compatibleAssets(current.channel).find(
                  (asset) => asset.id === current.assetId,
                )?.id ?? compatibleAssets(current.channel)[0]!.id,
            }),
            compatibleAssets(block.channel).length === 0,
          ),
          option(
            block,
            "action-stop",
            "停止通道",
            block.action === "stop",
            "停止当前声音通道并清空素材引用。",
            (current) => ({ ...current, action: "stop", assetId: null }),
          ),
        ]),
        section(
          "声音通道",
          (["bgm", "ambient", "sfx"] as const).map((channel) => {
            const disabled =
              block.action === "play" && compatibleAssets(channel).length === 0;
            return option(
              block,
              `channel-${channel}`,
              { bgm: "背景音乐", ambient: "环境音", sfx: "音效" }[channel],
              block.channel === channel,
              "切换声音所在的独立播放通道。",
              (current) => ({
                ...current,
                channel,
                assetId:
                  current.action === "play"
                    ? compatibleAssets(channel)[0]!.id
                    : null,
                volume: channel === "sfx" ? 100 : 70,
                loop: channel !== "sfx",
                fadeMs: channel === "sfx" ? 0 : 1000,
              }),
              disabled,
            );
          }),
        ),
        section(
          "音量",
          [50, 70, 100].map((volume) =>
            option(
              block,
              `volume-${volume}`,
              `${volume}%`,
              block.volume === volume,
              `将声音音量设置为 ${volume}%。`,
              (current) => ({ ...current, volume }),
              block.action === "stop",
            ),
          ),
        ),
        section("播放方式", [
          bool(
            block,
            "loop",
            "循环播放",
            block.loop,
            "切换声音是否循环播放。",
            (current, value) => ({ ...current, loop: value }),
          ),
        ]),
        section(
          block.action === "play" ? "淡入时长" : "淡出时长",
          durationOptions(
            block,
            block.fadeMs,
            [0, 500, 1000, 2000],
            (current, fadeMs) => ({
              ...current,
              fadeMs,
            }),
          ),
        ),
      ],
    };
  },
  particle: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "粒子动作",
        (["play", "stop"] as const).map((action) =>
          option(
            block,
            `action-${action}`,
            action === "play" ? "播放粒子" : "停止粒子",
            block.action === action,
            "切换粒子效果的播放状态。",
            (current) => ({
              ...current,
              action,
              durationMs: action === "stop" ? null : current.durationMs,
              waitForCompletion:
                action === "stop" ? false : current.waitForCompletion,
            }),
          ),
        ),
      ),
      section(
        "粒子预设",
        (["rain", "snow", "sakura", "dust", "sparkle", "fire"] as const).map(
          (preset) =>
            option(
              block,
              `preset-${preset}`,
              {
                rain: "雨",
                snow: "雪",
                sakura: "樱花",
                dust: "尘埃",
                sparkle: "闪光",
                fire: "火焰",
              }[preset],
              block.preset === preset,
              "切换当前粒子效果预设。",
              (current) => ({ ...current, preset }),
            ),
        ),
      ),
      section(
        "粒子密度",
        [0.5, 1, 2].map((density) =>
          option(
            block,
            `density-${density}`,
            `${density}×`,
            block.density === density,
            "设置粒子效果的密度。",
            (current) => ({ ...current, density }),
          ),
        ),
      ),
      section("持续时长", [
        option(
          block,
          "duration-continuous",
          "持续播放",
          block.durationMs == null,
          "持续播放粒子，直到遇到停止粒子 Block。",
          (current) => ({
            ...current,
            action: "play",
            durationMs: null,
            waitForCompletion: false,
          }),
        ),
        ...durationOptions(
          block,
          block.durationMs,
          [1000, 3000, 5000],
          (current, durationMs) => ({
            ...current,
            action: "play",
            durationMs,
          }),
        ),
      ]),
      section("执行方式", [
        option(
          block,
          "wait",
          "等待播放完成",
          block.waitForCompletion,
          "仅定时播放的粒子可以等待完成。",
          (current) => ({
            ...current,
            waitForCompletion: !current.waitForCompletion,
          }),
          block.action === "stop" || block.durationMs == null,
        ),
      ]),
    ],
  }),
  stageAnimation: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "动画目标",
        ["stage", "background", "characters", "cg"].map((target) =>
          option(
            block,
            `target-${target}`,
            {
              stage: "整个舞台",
              background: "背景",
              characters: "角色",
              cg: "CG",
            }[target] ?? target,
            block.target === target,
            "设置舞台动画的目标图层。",
            (current) => ({ ...current, target }),
          ),
        ),
      ),
      section(
        "动画预设",
        ["fade", "shake", "pulse", "zoom"].map((animation) =>
          option(
            block,
            `animation-${animation}`,
            { fade: "淡入淡出", shake: "震动", pulse: "脉冲", zoom: "缩放" }[
              animation
            ] ?? animation,
            block.animation === animation,
            "切换舞台动画预设。",
            (current) => ({ ...current, animation }),
          ),
        ),
      ),
      section(
        "动作时长",
        durationOptions(
          block,
          block.durationMs,
          [200, 500, 1000, 2000],
          (current, durationMs) => ({
            ...current,
            durationMs,
          }),
        ),
      ),
      section("执行方式", [
        bool(
          block,
          "wait",
          "等待动画完成",
          block.waitForCompletion,
          "切换是否等待舞台动画完成后继续。",
          (current, value) => ({ ...current, waitForCompletion: value }),
        ),
      ]),
    ],
  }),
  floatingText: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "垂直位置",
        [
          [20, "上方"],
          [50, "中间"],
          [80, "下方"],
        ].map(([y, label]) =>
          option(
            block,
            `position-${y}`,
            String(label),
            block.y === y,
            `将浮动文字移动到画面${label}。`,
            (current) => ({ ...current, y: Number(y) }),
          ),
        ),
      ),
      section(
        "显示时长",
        durationOptions(
          block,
          block.durationMs,
          [500, 1000, 1500, 3000],
          (current, durationMs) => ({
            ...current,
            durationMs,
          }),
        ),
      ),
      section("执行方式", [
        bool(
          block,
          "wait",
          "等待文字结束",
          block.waitForCompletion,
          "切换是否等待浮动文字演出完成后继续。",
          (current, value) => ({ ...current, waitForCompletion: value }),
        ),
      ]),
    ],
  }),
  curtain: (block) => ({
    includeInspector: false,
    sections: [
      section(
        "幕布设置",
        CURTAIN_MODE_OPTIONS.map((item) =>
          option(
            block,
            `mode-${item.value}`,
            item.label,
            block.mode === item.value,
            `将当前幕布形态设置为“${item.label}”。`,
            (current) => ({ ...current, mode: item.value }),
          ),
        ),
      ),
      section("幕布动作", [
        option(
          block,
          "action-show",
          "合上（屏幕变暗）",
          block.action === "show",
          "让幕布按当前形态和颜色进入画面。",
          (current) => ({ ...current, action: "show" }),
        ),
        option(
          block,
          "action-hide",
          "打开（屏幕显露）",
          block.action === "hide",
          "让当前幕布反向离场并显露舞台。",
          (current) => ({ ...current, action: "hide" }),
        ),
      ]),
      section(
        "动作时长",
        [0, 200, 500, 1000, 2000].map((durationMs) =>
          option(
            block,
            `duration-${durationMs}`,
            durationMs === 0 ? "立即" : `${durationMs / 1000} 秒`,
            block.durationMs === durationMs,
            `将幕布动画时长设置为 ${durationMs}ms。`,
            (current) => ({ ...current, durationMs }),
          ),
        ),
      ),
    ],
  }),
  video: (block, { story }) => {
    const videos = (story.assets ?? []).filter(
      (asset) => asset.type === "video",
    );
    return {
      includeInspector: true,
      sections: [
        section("视频动作", [
          option(
            block,
            "action-play",
            "播放 / 切换",
            block.action === "play",
            "播放视频；没有可用视频素材时不可用。",
            (current) => ({
              ...current,
              action: "play",
              assetId:
                videos.find((asset) => asset.id === current.assetId)?.id ??
                videos[0]!.id,
            }),
            videos.length === 0,
          ),
          option(
            block,
            "action-stop",
            "停止视频",
            block.action === "stop",
            "停止当前视频并清空素材引用。",
            (current) => ({
              ...current,
              action: "stop",
              assetId: null,
              waitForCompletion: false,
            }),
          ),
        ]),
        section(
          "画面适配",
          (["cover", "contain"] as const).map((fit) =>
            option(
              block,
              `fit-${fit}`,
              fit === "cover" ? "铺满裁切" : "完整显示",
              block.fit === fit,
              "设置视频的画面适配方式。",
              (current) => ({ ...current, fit }),
              block.action === "stop",
            ),
          ),
        ),
        section(
          "视频音量",
          [0, 50, 100].map((volume) =>
            option(
              block,
              `volume-${volume}`,
              volume === 0 ? "静音" : `${volume}%`,
              block.volume === volume,
              `将视频音量设置为 ${volume}%。`,
              (current) => ({ ...current, volume }),
              block.action === "stop",
            ),
          ),
        ),
        section("播放方式", [
          option(
            block,
            "loop",
            "循环播放",
            block.loop,
            "循环视频会自动关闭等待播放完成。",
            (current) => ({
              ...current,
              loop: !current.loop,
              waitForCompletion: !current.loop
                ? false
                : current.waitForCompletion,
            }),
            block.action === "stop",
          ),
          option(
            block,
            "wait",
            "播放完成后继续",
            block.waitForCompletion,
            "切换是否等待视频播放完成后继续。",
            (current) => ({
              ...current,
              waitForCompletion: !current.waitForCompletion,
            }),
            block.action === "stop" || block.loop,
          ),
        ]),
      ],
    };
  },
  animateSprite: (block) => ({
    includeInspector: true,
    sections: [
      section(
        "动画时长",
        durationOptions(
          block,
          block.durationMs,
          [200, 500, 1000, 2000],
          (current, durationMs) => ({
            ...current,
            durationMs,
          }),
        ),
      ),
      section("播放方式", [
        option(
          block,
          "loop",
          "循环播放",
          block.loop,
          "循环精灵动画会自动关闭等待完成。",
          (current) => ({
            ...current,
            loop: !current.loop,
            waitForCompletion: !current.loop
              ? false
              : current.waitForCompletion,
          }),
        ),
        option(
          block,
          "wait",
          "等待动画完成",
          block.waitForCompletion,
          "切换是否等待精灵动画完成后继续。",
          (current) => ({
            ...current,
            waitForCompletion: !current.waitForCompletion,
          }),
          block.loop,
        ),
      ]),
    ],
  }),
  autoPlay: (block) => ({
    includeInspector: false,
    sections: [
      section("自动播放", [
        option(
          block,
          "enabled-on",
          "开启",
          block.enabled,
          "开启自动播放模式。",
          (current) => ({ ...current, enabled: true }),
        ),
        option(
          block,
          "enabled-off",
          "关闭",
          !block.enabled,
          "关闭自动播放模式。",
          (current) => ({ ...current, enabled: false }),
        ),
      ]),
      section(
        "推进延迟",
        durationOptions(
          block,
          block.delayMs,
          [500, 1000, 1200, 2000],
          (current, delayMs) => ({
            ...current,
            delayMs,
          }),
        ),
      ),
    ],
  }),
  switchDialogueStyle: (block) => ({
    includeInspector: false,
    sections: [
      section(
        "对话框样式",
        (["dark", "light", "accent", "classicGradient", "custom"] as const).map(
          (preset) =>
            option(
              block,
              `preset-${preset}`,
              {
                dark: "深色",
                light: "浅色",
                accent: "强调色",
                classicGradient: "经典渐隐",
                custom: "自定义",
              }[preset],
              block.preset === preset,
              "切换后续对白使用的对话框样式。",
              (current) => ({ ...current, preset }),
            ),
        ),
      ),
    ],
  }),
  portraitStyleRule: (block) => ({
    includeInspector: false,
    sections: [
      section(
        "发言立绘模式",
        (["stage", "solo", "hidden"] as const).map((mode) =>
          option(
            block,
            `mode-${mode}`,
            { stage: "舞台立绘", solo: "单人立绘", hidden: "隐藏立绘" }[mode],
            block.mode === mode,
            "设置后续对白的发言立绘规则。",
            (current) => ({ ...current, mode }),
          ),
        ),
      ),
      section("规则状态", [
        bool(
          block,
          "keep",
          "结束后继续沿用",
          block.keepAfter,
          "切换此发言立绘规则是否持续生效。",
          (current, value) => ({ ...current, keepAfter: value }),
        ),
      ]),
    ],
  }),
  gallery: (block, { story }) => {
    const compatibleAssets = (action: typeof block.action) =>
      (story.assets ?? []).filter((asset) =>
        action === "unlockMusic"
          ? asset.type === "audio"
          : asset.type === "image",
      );
    return {
      includeInspector: true,
      sections: [
        section(
          "解锁类型",
          (["unlockCg", "unlockScene", "unlockMusic"] as const).map((action) =>
            option(
              block,
              `action-${action}`,
              {
                unlockCg: "CG 鉴赏",
                unlockScene: "场景鉴赏",
                unlockMusic: "音乐鉴赏",
              }[action],
              block.action === action,
              "切换鉴赏条目的解锁类型，并自动选择兼容素材。",
              (current) => ({
                ...current,
                action,
                assetId: compatibleAssets(action)[0]!.id,
              }),
              compatibleAssets(action).length === 0,
            ),
          ),
        ),
      ],
    };
  },
  branch: (block) => ({
    includeInspector: true,
    sections: [
      section("当前状态", [
        {
          id: "context-branch-summary",
          label: `${block.choices.length} 个选项`,
          checked: true,
          disabled: true,
          description: "分支提示与选项目标请在右侧属性中编辑。",
          apply: (current) => current,
        },
      ]),
    ],
  }),
  if: (block, { story }) => {
    const fragmentTitle = (id: string | null | undefined) =>
      story.chapters
        ?.flatMap((chapter) => chapter.fragments ?? [])
        .find((fragment) => fragment.id === id)?.title ?? "未设置";
    return {
      includeInspector: true,
      sections: [
        section("当前状态", [
          {
            id: "context-if-summary",
            label: `成立 → ${fragmentTitle(block.thenFragmentId)}`,
            checked: true,
            disabled: true,
            description: `否则 → ${fragmentTitle(block.elseFragmentId)}；条件表达式与目标请在右侧属性中编辑。`,
            apply: (current) => current,
          },
        ]),
      ],
    };
  },
  setVariable: (block, { story }) => {
    const variable = story.variables?.find(
      (item) => item.id === block.variableId,
    );
    const operators =
      variable?.type === "number"
        ? (["set", "add", "subtract", "multiply", "divide"] as const)
        : variable?.type === "boolean"
          ? (["set", "toggle"] as const)
          : (["set"] as const);
    const labels = {
      set: "设为",
      add: "加",
      subtract: "减",
      multiply: "乘",
      divide: "除",
      toggle: "切换真假",
    } as const;
    return {
      includeInspector: true,
      sections: [
        section(
          `变量运算 · ${variable?.name ?? "未知变量"}`,
          operators.map((operator) =>
            option(
              block,
              `operator-${operator}`,
              labels[operator],
              block.operator === operator,
              `对${variable?.type ?? "未知"}变量使用“${labels[operator]}”运算。`,
              (current) => ({ ...current, operator }),
            ),
          ),
        ),
      ],
    };
  },
  callFragment: (block, { story }) => {
    const target = story.chapters
      ?.flatMap((chapter) => chapter.fragments ?? [])
      .find((fragment) => fragment.id === block.targetFragmentId);
    return {
      includeInspector: true,
      sections: [
        section("当前状态", [
          {
            id: "context-call-fragment-summary",
            label: `调用 → ${target?.title ?? "未知 Fragment"}`,
            checked: true,
            disabled: true,
            description: "调用结束后返回当前位置；目标请在右侧属性中编辑。",
            apply: (current) => current,
          },
        ]),
      ],
    };
  },
  endChapter: (block) => ({
    includeInspector: true,
    sections: [
      section("当前状态", [
        {
          id: "context-end-chapter-summary",
          label: block.label,
          checked: true,
          disabled: true,
          description: "结局名称和关联结局请在右侧属性中编辑。",
          apply: (current) => current,
        },
      ]),
    ],
  }),
  returnToEntry: () => ({
    includeInspector: false,
    sections: [
      section("当前状态", [
        {
          id: "context-return-to-entry-summary",
          label: "重置状态并返回入口章",
          checked: true,
          disabled: true,
          description: "试玩到此会清空变量、舞台和持续媒体状态。",
          apply: (current) => current,
        },
      ]),
    ],
  }),
} satisfies Registry;

export const BLOCK_CONTEXT_SETTINGS_REGISTRY = registry;

export function blockContextSettings(
  block: GalgameStoryBlock,
  story: GalgameStoryProject,
): BlockContextSettings {
  const factory = registry[block.type] as (
    block: GalgameStoryBlock,
    context: Context,
  ) => BlockContextSettings;
  return factory(block, { story });
}
