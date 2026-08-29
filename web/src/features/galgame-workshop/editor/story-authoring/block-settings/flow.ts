import {
  option,
  section,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";

export const flowBlockContextSettings = {
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
} satisfies Partial<Registry>;
