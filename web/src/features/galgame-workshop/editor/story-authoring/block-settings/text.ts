import { WAIT_DURATION_PRESETS } from "@features/galgame-workshop/editor/blockRegistry";
import {
  bool,
  durationOptions,
  option,
  section,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";

export const textBlockContextSettings = {
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
} satisfies Partial<Registry>;
