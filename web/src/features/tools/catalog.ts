import type { LucideIcon } from "lucide-react";
import {
  Binary,
  Braces,
  Calculator,
  Clock3,
  Diff,
  Download,
  Film,
  HardDrive,
  MessageSquareText,
  Palette,
  PlugZap,
  Regex,
  Settings2,
} from "lucide-react";

export type ToolCategory =
  "development" | "data" | "text" | "model" | "productivity";

export type ToolTarget =
  { kind: "internal"; path: string } | { kind: "external"; href: string };

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  tags: string[];
  icon: LucideIcon;
  target: ToolTarget;
};

export const TOOL_CATEGORIES: Array<{
  value: "all" | ToolCategory;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "development", label: "开发调试" },
  { value: "data", label: "数据处理" },
  { value: "text", label: "文本工具" },
  { value: "model", label: "模型工具" },
  { value: "productivity", label: "效率工具" },
];

export const POPULAR_TAGS = ["JSON", "接口", "Token", "编码", "转换"];

export const TOOLS: ToolDefinition[] = [
  {
    id: "storage-usage",
    name: "空间占用",
    description:
      "通过 GrandPerspective 查看磁盘占用，在 Finder 中定位目录并手动整理",
    category: "productivity",
    tags: ["磁盘", "空间", "目录", "存储", "GrandPerspective", "清理"],
    icon: HardDrive,
    target: { kind: "internal", path: "/tools/storage-usage" },
  },
  {
    id: "codex-model-source",
    name: "Codex 模型源",
    description: "查看并切换这台电脑上的 Codex 模型供应商",
    category: "model",
    tags: ["Codex", "模型", "供应商", "API"],
    icon: Settings2,
    target: { kind: "internal", path: "/tools/codex-model-source" },
  },
  {
    id: "video-frame-exporter",
    name: "视频帧导出",
    description: "定位视频时间点并导出高清图片帧",
    category: "data",
    tags: ["视频", "截帧", "图片", "格式", "转换"],
    icon: Film,
    target: { kind: "internal", path: "/tools/video-frame-exporter" },
  },
  {
    id: "video-downloader",
    name: "视频下载",
    description: "从抖音或哔哩哔哩链接下载视频到本机或文件库",
    category: "data",
    tags: ["视频", "下载", "抖音", "B站", "转换"],
    icon: Download,
    target: { kind: "internal", path: "/tools/video-downloader" },
  },
  {
    id: "json-formatter",
    name: "JSON 格式化",
    description: "美化、压缩并校验 JSON 数据",
    category: "data",
    tags: ["JSON", "格式化", "校验", "转换"],
    icon: Braces,
    target: { kind: "external", href: "https://onlinejsonformatter.com/" },
  },
  {
    id: "api-debugger",
    name: "接口调试",
    description: "构造 API 请求并检查响应结果",
    category: "development",
    tags: ["接口", "API", "HTTP", "调试"],
    icon: PlugZap,
    target: { kind: "external", href: "https://hoppscotch.io/" },
  },
  {
    id: "token-estimator",
    name: "Token 估算",
    description: "估算文本的 Token 数量",
    category: "model",
    tags: ["Token", "模型", "文本"],
    icon: Calculator,
    target: { kind: "external", href: "https://platform.openai.com/tokenizer" },
  },
  {
    id: "base64-codec",
    name: "Base64 编解码",
    description: "文本与 Base64 内容相互转换",
    category: "data",
    tags: ["Base64", "编码", "解码", "转换"],
    icon: Binary,
    target: { kind: "external", href: "https://base64.guru/converter" },
  },
  {
    id: "timestamp-converter",
    name: "时间戳转换",
    description: "时间戳与日期时间相互转换",
    category: "data",
    tags: ["时间戳", "日期", "转换"],
    icon: Clock3,
    target: {
      kind: "external",
      href: "https://www.unixtimestampconverter.com/",
    },
  },
  {
    id: "regex-tester",
    name: "正则表达式测试",
    description: "在线测试与调试正则表达式",
    category: "development",
    tags: ["正则", "Regex", "测试", "调试"],
    icon: Regex,
    target: { kind: "external", href: "https://regex101.com/" },
  },
  {
    id: "text-diff",
    name: "文本对比",
    description: "并排查看两段文本之间的差异",
    category: "text",
    tags: ["文本", "Diff", "对比"],
    icon: Diff,
    target: { kind: "external", href: "https://diffchecker.io/" },
  },
  {
    id: "color-converter",
    name: "颜色格式转换",
    description: "在 HEX、RGB、HSL 等格式间转换",
    category: "productivity",
    tags: ["颜色", "HEX", "RGB", "转换"],
    icon: Palette,
    target: {
      kind: "external",
      href: "https://www.w3schools.com/tools/tool_color_converter.php",
    },
  },
  {
    id: "prompt-library",
    name: "Prompt 模板库",
    description: "浏览并复用常用 Prompt 模板",
    category: "model",
    tags: ["Prompt", "模型", "模板"],
    icon: MessageSquareText,
    target: { kind: "external", href: "https://prompts.chat/" },
  },
];

export const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export function categoryLabel(category: ToolCategory): string {
  return (
    TOOL_CATEGORIES.find((item) => item.value === category)?.label ?? category
  );
}
