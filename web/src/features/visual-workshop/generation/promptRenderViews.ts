import type { ComponentProps, ComponentType } from "react";
import { H3PromptPreview } from "./H3PromptPreview";
import { h3PromptMentions } from "./h3PromptMentions";

/** Frontend views are registered separately from the pure source parsers. */
export const promptRenderViews: Record<
  string,
  {
    Editor: ComponentType<ComponentProps<typeof H3PromptPreview>>;
    mentions: typeof h3PromptMentions;
    help: string;
  }
> = {
  "minimax-h3": {
    Editor: H3PromptPreview,
    mentions: h3PromptMentions,
    help: "可直接编辑或粘贴提示词，按当前模板即时渲染。输入 @ 引用图像、视频、音频、主体、说话人或插入对白；复制和生成保留 H3 原文。",
  },
};
