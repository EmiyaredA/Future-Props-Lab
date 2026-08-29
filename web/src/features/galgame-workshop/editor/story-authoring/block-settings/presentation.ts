import {
  bool,
  durationOptions,
  option,
  section,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";

export const presentationBlockContextSettings = {
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
} satisfies Partial<Registry>;
