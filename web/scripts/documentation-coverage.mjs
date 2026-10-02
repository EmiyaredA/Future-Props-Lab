import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const articleRoot = path.join(root, "web/src/docs/articles");
const entries = {
  start: "文档中心 / 开始使用",
  account: "Studio 侧栏 / 当前 Workspace 或账号卡片",
  files: "Studio / 文件管理",
  integrations: "Studio / 集成中心",
  creative: "Studio / 创意工坊",
  desktop: "桌面顶栏 / Amadeus 与账号设置 / 本地 Agent",
  models: "Studio / 基模型 / 模型服务",
  testing: "Studio / 基模型 / 模型测试",
  logs: "Studio / 基模型 / 模型调用日志",
  apps: "Studio / 应用",
  visual: "应用 / 视觉创作工坊",
  galgame: "应用 / Galgame 工坊",
  video: "应用 / 视频剪辑工坊",
  thought: "应用 / 思绪工坊",
  presentation: "应用 / 演示工坊",
  live2d: "应用 / Live2D 工坊",
  pet: "应用 / 桌宠工坊",
  director: "应用 / 导演台",
  motion: "应用 / 特效制作工坊",
  tools: "Studio / 工具导航",
  annotation: "应用 / 录音标注工坊",
  frames: "工具导航 / 视频帧导出",
  external: "工具导航 / 外部网站",
  help: "文档中心 / 通用帮助",
};
const tests = {
  start: "web/tests/navigation.test.tsx",
  account: "web/src/features/accounts/AccountWorkspacePanel.tsx",
  files: "web/src/features/files/AssetBrowser.tsx",
  integrations: "web/e2e/integration-center.spec.ts",
  creative: "web/e2e/creative-workshop.spec.ts",
  desktop: "tests/test_amadeus_workflows.py",
  models: "web/e2e/base-model-ui.spec.ts",
  testing: "web/e2e/base-model-ui.spec.ts",
  logs: "web/src/features/models/logs/ModelCallLogDetail.tsx",
  apps: "web/e2e/project-snapshot.spec.ts",
  visual: "web/tests/visual-workshop-canvas-nodes.test.tsx",
  galgame: "web/tests/galgame-workshop-editor.test.tsx",
  video: "web/e2e/video-editor.spec.ts",
  thought: "web/tests/thought-workshop.test.tsx",
  presentation: "web/e2e/presentation-workshop.spec.ts",
  live2d: "web/e2e/live2d-workshop.spec.ts",
  pet: "tests/test_desktop_pet.py",
  director: "tests/test_director_desk_projects.py",
  motion: "web/e2e/motion-compositor.spec.ts",
  tools: "web/e2e/tool-navigation.spec.ts",
  annotation: "web/tests/audio-annotation-model.test.ts",
  frames: "web/src/features/tools/VideoFrameExporterPage.tsx",
  external: "web/e2e/tool-navigation.spec.ts",
  help: "web/e2e/docs.spec.ts",
};
const articles = [];
for (const group of fs.readdirSync(articleRoot).sort()) {
  if (!fs.statSync(path.join(articleRoot, group)).isDirectory()) continue;
  const pages = fs
    .readdirSync(path.join(articleRoot, group))
    .filter((n) => n.endsWith(".md"))
    .map((name) => {
      const source = `web/src/docs/articles/${group}/${name}`;
      const raw = fs.readFileSync(path.join(root, source), "utf8");
      const meta = JSON.parse(/^<!-- docs: (.*) -->/.exec(raw)[1]);
      if ((meta.category || "use") !== "use") return null;
      if (meta.group !== group || !entries[meta.group] || !tests[meta.group])
        throw Error(`使用文章缺少入口或核验依据：${source}`);
      if (!fs.existsSync(path.join(root, tests[meta.group])))
        throw Error(`核验依据不存在：${tests[meta.group]}`);
      return {
        ...meta,
        id: name.slice(0, -3),
        source,
        images: [
          ...raw.matchAll(
            /(?:!\[[^\]]+\]\(|<Screenshot\s+src=")\/docs\/([^\s)"]+)/g,
          ),
        ].map((m) => m[1]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  articles.push(...pages);
}
articles.sort(
  (a, b) =>
    Object.keys(entries).indexOf(a.group) -
      Object.keys(entries).indexOf(b.group) ||
    a.order - b.order ||
    a.id.localeCompare(b.id),
);
const rows = articles
  .map(
    (p) =>
      `| ${entries[p.group]} | [${p.title}](../../${p.source}) · \`${p.id}\` | ${[...new Set([...p.evidence, tests[p.group]])].map((e) => (e.startsWith("https:") ? `[网站](${e})` : `[${e}](../../${e})`)).join("；")} | ${p.images.length ? p.images.map((i) => `[${i}](../../web/public/docs/${i})`).join("；") : "说明页；无强制配图"} |`,
  )
  .join("\n");
const content = `# 文档中心覆盖清单\n\n按当前工作区正文自动生成，共 ${articles.length} 篇使用文章。页面与章节、内部链接、旧链接映射、图片和 JSON 示例由 \`web/tests/docs-content.test.ts\` 校验。\n\n## 核验口径\n\n- 每行的入口对应实际功能模块；依据列区分实现文件与测试文件，不表示每篇都独立运行了端到端测试。\n- 截图来自隔离数据库和自建素材，经正式账号用例与 /v1 API 准备；逐图场景见 [截图来源](../../web/public/docs/sources.json)。\n- 配置态图片不表示已调用模型。文本连接诊断使用本机确定性响应；图片失败状态使用本机返回的无图片响应，未调用付费供应商。\n- 实时语音未执行真实麦克风通话；外部模型生成质量、外部 MCP 服务与第三方网站账号功能不在本次联网验收范围内。\n- 浏览器阅读回归覆盖搜索范围、无结果、专属目录、返回父级、旧链接刷新、历史、主题、图片放大、键盘焦点与移动抽屉。\n\n## 入口、文章与依据\n\n| 实际入口 | 对应文章 | 实现 / 核验依据 | 截图 |\n| --- | --- | --- | --- |\n${rows}\n\n## 维护\n\n修改正文或配图后运行 \`node web/scripts/documentation-coverage.mjs --write\`；不带参数检查清单是否过期。文档内容只维护于原 Markdown，导航、搜索与复制不保存第二份正文。开发者/API 分类从仓库原文件加载。\n`;
const target = path.join(root, "docs/architecture/documentation-coverage.md");
if (process.argv.includes("--write")) fs.writeFileSync(target, content);
else if (
  !fs.existsSync(target) ||
  fs.readFileSync(target, "utf8") !== content
) {
  console.error("文档覆盖清单已过期，请运行 --write");
  process.exitCode = 1;
} else console.log(`${articles.length} 篇文章覆盖清单一致`);
