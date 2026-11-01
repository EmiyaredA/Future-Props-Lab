import type { components } from "../../src/generated/api";

type Conversation = components["schemas"]["WorkbenchSessionOut"];
type Entry = components["schemas"]["WorkbenchEntryOut"];
export const workbenchSource = {
  id: "fixture-source",
  agent_id: "opencode",
  label: "OpenCode · 本机项目",
  root: "/fixture/opencode",
  endpoint: "",
  enabled: true,
  revision: 0,
  status: "following",
  message: "日志跟随 · 已发现 8 个记录",
  last_synced_at: "2026-11-01T06:21:00Z",
  sync_mode: "log_follow",
} satisfies components["schemas"]["WorkbenchSourceOut"];
export const workbenchSessions: Conversation[] = [
  ["opencode", "修复文件上传后的预览状态", "app", "demo-app"],
  ["codex", "优化首页加载性能", "app", "future-props-lab"],
  ["codex", "重构用户认证模块", "cli", "future-props-lab"],
  ["claude-code", "添加数据导出功能", "cli", "analytics"],
  ["claude-code", "修复测试用例失败", "app", "demo-app"],
  ["opencode", "实现图片裁剪功能", "cli", "demo-app"],
  ["dsh", "生成数据分析脚本", "unknown", "analytics"],
  ["pi", "调研新的向量数据库方案", "unknown", "research"],
].map(([agent, title, surface, project], index) => ({
  id: `fixture-${index}`,
  agent_id: agent as Conversation["agent_id"],
  native_id: `native-session-${index}`,
  title,
  alias: "",
  favorite: false,
  revision: 0,
  cwd: `/fixture/projects/${project}`,
  origins: surface === "unknown" ? [] : [surface],
  evidence: surface === "unknown" ? [] : [`原生标记 source=${surface}`],
  native_model: "fixture-model",
  parent_native_id: null,
  archived: false,
  updated_at: `2026-11-01T06:${String(21 - index).padStart(2, "0")}:00Z`,
  last_synced_at: "2026-11-01T06:21:00Z",
  source_ids: [workbenchSource.id],
  source_errors: [],
  can_send: false,
  continuation_reason: "当前支持查看与同步，继续对话待接入",
}));

export function workbenchEntries(count = 4): Entry[] {
  const content = [
    [
      "user",
      "message",
      "我刚刚上传了一张图片，但是预览区域一直显示加载中，帮我看下是什么问题？\n\n文件正常上传成功了，就是预览一直转圈。",
      "",
    ],
    [
      "assistant",
      "message",
      "我来帮你检查一下文件上传后的预览状态问题。根据代码分析，这是一个状态更新时序问题。\n\n**问题原因**：上传成功后，`previewUrl` 的设置发生在异步读取文件之后，但组件先触发了预览渲染，导致 URL 仍然为空。",
      "",
    ],
    [
      "tool",
      "tool_result",
      "src/Preview.tsx\n\nexport function Preview() {\n  const [previewUrl, setPreviewUrl] = useState<string | null>(null);\n}",
      "Read · src/Preview.tsx",
    ],
    [
      "assistant",
      "message",
      "已经定位到问题。建议在上传成功后立即创建预览 URL，并在组件卸载时清理：\n\n```tsx\nuseEffect(() => {\n  if (!file) return;\n  const url = URL.createObjectURL(file);\n  setPreviewUrl(url);\n  return () => URL.revokeObjectURL(url);\n}, [file]);\n```\n\n这样预览状态会随文件更新，离开页面时也会释放资源。",
      "",
    ],
  ];
  return Array.from({ length: count }, (_, index) => {
    const [role, kind, text, tool] = content[index % content.length];
    return {
      id: `entry-${index}`,
      native_id: `native-entry-${index}`,
      ordinal: index,
      role,
      kind,
      text: count > 4 ? `${text}\n\n记录 ${index + 1}` : text,
      timestamp: "2026-11-01T06:21:00Z",
      parent_id: null,
      tool_name: tool,
      attachments: [],
    };
  });
}
