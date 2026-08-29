import {
  bool,
  cgOverlay,
  cgTransition,
  characterTransform,
  characterTransition,
  durationOptions,
  option,
  section,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";

export const stageBlockContextSettings = {
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
} satisfies Partial<Registry>;
