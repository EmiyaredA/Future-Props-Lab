import { CURTAIN_MODE_OPTIONS } from "@features/galgame-workshop/editor/blockRegistry";
import {
  audioRole,
  bool,
  durationOptions,
  option,
  section,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";

export const mediaBlockContextSettings = {
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
} satisfies Partial<Registry>;
