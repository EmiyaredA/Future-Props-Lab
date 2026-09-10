import {
  Star,
  Heart,
  Check,
  CircleHelp,
  Flag,
  Bookmark,
  FileText,
  Folder,
  Image,
  Files,
  Clipboard,
  Archive,
  Briefcase,
  ChartColumn,
  Target,
  Lightbulb,
  Trophy,
  Presentation,
  Cpu,
  Database,
  Code,
  Workflow,
  Cloud,
  Bot,
  User,
  Users,
  UserCheck,
  Contact,
  GraduationCap,
  Handshake,
} from "lucide-react";
export const iconCatalog = [
  ["常用", "星标 star", Star],
  ["常用", "喜欢 heart", Heart],
  ["常用", "完成 check", Check],
  ["常用", "帮助 help", CircleHelp],
  ["常用", "旗帜 flag", Flag],
  ["常用", "书签 bookmark", Bookmark],
  ["文件", "文档 file text", FileText],
  ["文件", "文件夹 folder", Folder],
  ["文件", "图片 image", Image],
  ["文件", "文件 files", Files],
  ["文件", "剪贴板 clipboard", Clipboard],
  ["文件", "归档 archive", Archive],
  ["商务", "公文包 briefcase", Briefcase],
  ["商务", "图表 chart", ChartColumn],
  ["商务", "目标 target", Target],
  ["商务", "想法 lightbulb", Lightbulb],
  ["商务", "奖杯 trophy", Trophy],
  ["商务", "演示 presentation", Presentation],
  ["科技", "芯片 cpu", Cpu],
  ["科技", "数据库 database", Database],
  ["科技", "代码 code", Code],
  ["科技", "工作流 workflow", Workflow],
  ["科技", "云 cloud", Cloud],
  ["科技", "机器人 bot", Bot],
  ["人物", "用户 user", User],
  ["人物", "团队 users", Users],
  ["人物", "认证 user check", UserCheck],
  ["人物", "联系人 contact", Contact],
  ["人物", "教育 graduation", GraduationCap],
  ["人物", "合作 handshake", Handshake],
] as const;
export function iconSource(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))])
    for (const attr of Array.from(node.attributes))
      if (
        attr.name === "class" ||
        attr.name.startsWith("aria-") ||
        attr.name.startsWith("data-")
      )
        node.removeAttribute(attr.name);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "24");
  clone.setAttribute("height", "24");
  clone.setAttribute("stroke", "#334155");
  return new XMLSerializer().serializeToString(clone);
}
